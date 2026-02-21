use crate::phase_vocoder::PhaseVocoder;
use crate::resampler::SincResampler;

const CHANNELS: usize = 2;
const FFT_SIZE: usize = 2048;
const ANALYSIS_HOP: usize = 512;

const FLOAT_EPSILON: f32 = 1e-10;

/// Phase-vocoder pitch shifter with sinc resampling.
///
/// Maintains SoundTouch-compatible semantics:
///   effective_tempo = virtual_tempo / virtual_pitch
///   effective_rate  = virtual_rate  * virtual_pitch
///
/// Pipeline: input -> deinterleave -> [PhaseVocoder per channel] -> [SincResampler per channel] -> interleave -> output
pub struct PitchShifter {
    pv_left: PhaseVocoder,
    pv_right: PhaseVocoder,
    rs_left: SincResampler,
    rs_right: SincResampler,

    virtual_pitch: f32,
    virtual_rate: f32,
    virtual_tempo: f32,

    effective_stretch: f32, // PV time-stretch ratio (synthesis_hop / analysis_hop)
    effective_resample: f32, // resampler ratio (input_rate / output_rate for the resampler)

    // Intermediate mono buffers (preallocated)
    mono_left: Vec<f32>,
    mono_right: Vec<f32>,
    pv_out_buf: Vec<f32>,
    rs_out_buf: Vec<f32>,
    rs_right_buf: Vec<f32>,

    // Output interleaved FIFO
    output_buf: Vec<f32>,
    output_len: usize,
    output_read: usize,
}

impl PitchShifter {
    pub fn new(_sample_rate: f32) -> Self {
        let mut s = Self {
            pv_left: PhaseVocoder::new(FFT_SIZE, ANALYSIS_HOP),
            pv_right: PhaseVocoder::new(FFT_SIZE, ANALYSIS_HOP),
            rs_left: SincResampler::new(),
            rs_right: SincResampler::new(),
            virtual_pitch: 1.0,
            virtual_rate: 1.0,
            virtual_tempo: 1.0,
            effective_stretch: 1.0,
            effective_resample: 1.0,
            mono_left: Vec::with_capacity(512),
            mono_right: Vec::with_capacity(512),
            pv_out_buf: vec![0.0; 4096],
            rs_out_buf: vec![0.0; 4096],
            rs_right_buf: vec![0.0; 4096],
            output_buf: vec![0.0; 8192],
            output_len: 0,
            output_read: 0,
        };
        s.update_parameters();
        s
    }

    pub fn clear(&mut self) {
        self.pv_left.clear();
        self.pv_right.clear();
        self.rs_left.clear();
        self.rs_right.clear();
        self.output_len = 0;
        self.output_read = 0;
    }

    pub fn set_rate(&mut self, rate: f32) {
        self.virtual_rate = rate;
        self.update_parameters();
    }

    pub fn set_tempo(&mut self, tempo: f32) {
        self.virtual_tempo = tempo;
        self.update_parameters();
    }

    pub fn set_pitch(&mut self, pitch: f32) {
        self.virtual_pitch = pitch;
        self.update_parameters();
    }

    /// Feed interleaved stereo samples.
    pub fn put_samples(&mut self, samples: &[f32], num_frames: usize) {
        let count = num_frames.min(samples.len() / CHANNELS);

        self.mono_left.clear();
        self.mono_right.clear();
        self.mono_left.reserve(count);
        self.mono_right.reserve(count);

        for i in 0..count {
            self.mono_left.push(samples[i * 2]);
            self.mono_right.push(samples[i * 2 + 1]);
        }

        self.pv_left.push_input(&self.mono_left);
        self.pv_right.push_input(&self.mono_right);
    }

    /// Run the processing pipeline.
    pub fn process(&mut self) {
        self.pv_left.process();
        self.pv_right.process();

        // Drain PV output into resampler
        self.drain_pv_to_resampler(&mut PvChannel::Left);
        self.drain_pv_to_resampler(&mut PvChannel::Right);

        // Drain resampler output into interleaved output buffer
        self.drain_resamplers_to_output();
    }

    /// Read processed interleaved stereo frames. Returns frames actually read.
    pub fn receive_samples(&mut self, output: &mut [f32], max_frames: usize) -> usize {
        let avail_frames = (self.output_len - self.output_read) / CHANNELS;
        let frames = avail_frames.min(max_frames).min(output.len() / CHANNELS);
        if frames == 0 { return 0; }

        let samples = frames * CHANNELS;
        output[..samples].copy_from_slice(
            &self.output_buf[self.output_read..self.output_read + samples]
        );
        self.output_read += samples;

        self.compact_output();
        frames
    }

    fn update_parameters(&mut self) {
        let tempo = self.virtual_tempo / self.virtual_pitch;
        let rate = self.virtual_rate * self.virtual_pitch;

        // PV stretch ratio: we want to time-stretch by 1/tempo
        // stretch_ratio > 1 means output is longer (slower), < 1 means shorter (faster)
        let new_stretch = 1.0 / tempo;
        if (new_stretch - self.effective_stretch).abs() > FLOAT_EPSILON {
            self.effective_stretch = new_stretch;
            self.pv_left.set_stretch_ratio(new_stretch);
            self.pv_right.set_stretch_ratio(new_stretch);
        }

        // Resampler: ratio = 1/rate means for each input sample, produce 1/rate outputs
        // rate > 1 -> fewer output samples (pitch up)
        // rate < 1 -> more output samples (pitch down)
        let new_resample = rate;
        if (new_resample - self.effective_resample).abs() > FLOAT_EPSILON {
            self.effective_resample = new_resample;
            self.rs_left.set_ratio(new_resample);
            self.rs_right.set_ratio(new_resample);
        }
    }

    fn drain_pv_to_resampler(&mut self, channel: &mut PvChannel) {
        loop {
            let buf_len = self.pv_out_buf.len();
            let (pv, rs) = match channel {
                PvChannel::Left => (&mut self.pv_left, &mut self.rs_left),
                PvChannel::Right => (&mut self.pv_right, &mut self.rs_right),
            };
            let n = pv.read_output(&mut self.pv_out_buf, buf_len);
            if n == 0 { break; }
            rs.push_input(&self.pv_out_buf[..n]);
        }
    }

    fn drain_resamplers_to_output(&mut self) {
        loop {
            let buf_len = self.rs_out_buf.len();
            let n_left = self.rs_left.read_output(&mut self.rs_out_buf, buf_len);
            if n_left == 0 { break; }

            if n_left > self.rs_right_buf.len() {
                self.rs_right_buf.resize(n_left, 0.0);
            }
            let n_right = self.rs_right.read_output(&mut self.rs_right_buf, n_left);
            let frames = n_left.min(n_right);

            let needed = self.output_len + frames * CHANNELS;
            if needed > self.output_buf.len() {
                self.output_buf.resize(needed + 1024, 0.0);
            }

            for i in 0..frames {
                self.output_buf[self.output_len] = self.rs_out_buf[i];
                self.output_buf[self.output_len + 1] = self.rs_right_buf[i];
                self.output_len += CHANNELS;
            }
        }
    }

    fn compact_output(&mut self) {
        if self.output_read >= 1024 {
            self.output_buf.copy_within(self.output_read..self.output_len, 0);
            self.output_len -= self.output_read;
            self.output_read = 0;
        }
    }
}

enum PvChannel { Left, Right }
