use core::f32::consts::PI;
use crate::fft::Fft;

const TWO_PI: f32 = 2.0 * PI;

/// STFT-based phase vocoder with Laroche-Dolson identity phase locking.
///
/// Performs time-stretching without changing pitch.
/// The stretch ratio is `synthesis_hop / analysis_hop`.
///
/// Uses Hann windows for both analysis and synthesis. A per-sample COLA
/// normalization array ensures exact unity gain for any synthesis hop,
/// including non-dividing hop sizes where the standard constant is not exact.
pub struct PhaseVocoder {
    fft_size: usize,
    analysis_hop: usize,
    synthesis_hop: usize,

    fft: Fft,
    window: Vec<f32>,

    /// Per-sample normalization: norm_array[i % synthesis_hop] = 1 / ∑_k w²(i + k*Hs)
    /// Precomputed for the current synthesis hop. Length = synthesis_hop.
    norm_array: Vec<f32>,

    input_buf: Vec<f32>,
    input_write_pos: usize,
    frames_until_next_analysis: usize,

    prev_analysis_phase: Vec<f32>,
    synthesis_phase: Vec<f32>,
    prev_synth_phase: Vec<f32>,

    frame_re: Vec<f32>,
    frame_im: Vec<f32>,
    magnitude: Vec<f32>,
    analysis_phase: Vec<f32>,
    peak_flags: Vec<bool>,
    assigned_peak: Vec<usize>,
    assigned_dist: Vec<usize>,

    output_accum: Vec<f32>,
    output_accum_len: usize,
    output_read_pos: usize,

    first_frame: bool,
}

impl PhaseVocoder {
    pub fn new(fft_size: usize, analysis_hop: usize) -> Self {
        debug_assert!(fft_size.is_power_of_two());
        debug_assert!(analysis_hop > 0 && analysis_hop <= fft_size);

        let half = fft_size / 2 + 1;
        let window: Vec<f32> = (0..fft_size)
            .map(|i| 0.5 * (1.0 - (TWO_PI * i as f32 / fft_size as f32).cos()))
            .collect();

        let norm_array = compute_norm_array(&window, analysis_hop);
        let output_capacity = fft_size * 4;

        Self {
            fft_size,
            analysis_hop,
            synthesis_hop: analysis_hop,
            fft: Fft::new(fft_size),
            window,
            norm_array,
            input_buf: vec![0.0; fft_size + analysis_hop * 8],
            input_write_pos: 0,
            frames_until_next_analysis: 0,
            prev_analysis_phase: vec![0.0; half],
            synthesis_phase: vec![0.0; half],
            prev_synth_phase: vec![0.0; half],
            frame_re: vec![0.0; fft_size],
            frame_im: vec![0.0; fft_size],
            magnitude: vec![0.0; half],
            analysis_phase: vec![0.0; half],
            peak_flags: vec![false; half],
            assigned_peak: vec![0; half],
            assigned_dist: vec![0; half],
            output_accum: vec![0.0; output_capacity],
            output_accum_len: 0,
            output_read_pos: 0,
            first_frame: true,
        }
    }

    pub fn set_stretch_ratio(&mut self, ratio: f32) {
        let max_hop = self.fft_size / 2;
        let new_hop = (self.analysis_hop as f32 * ratio)
            .round()
            .max(1.0) as usize;
        let new_hop = new_hop.min(max_hop);
        if new_hop != self.synthesis_hop {
            self.synthesis_hop = new_hop;
            self.norm_array = compute_norm_array(&self.window, new_hop);
        }
    }

    pub fn clear(&mut self) {
        self.input_write_pos = 0;
        self.frames_until_next_analysis = 0;
        self.first_frame = true;
        for v in self.prev_analysis_phase.iter_mut() { *v = 0.0; }
        for v in self.synthesis_phase.iter_mut() { *v = 0.0; }
        self.output_accum.iter_mut().for_each(|v| *v = 0.0);
        self.output_accum_len = 0;
        self.output_read_pos = 0;
    }

    pub fn push_input(&mut self, samples: &[f32]) {
        let needed = self.input_write_pos + samples.len();
        if needed > self.input_buf.len() {
            self.input_buf.resize(needed + self.analysis_hop * 4, 0.0);
        }
        self.input_buf[self.input_write_pos..self.input_write_pos + samples.len()]
            .copy_from_slice(samples);
        self.input_write_pos += samples.len();
    }

    pub fn can_process_frame(&self) -> bool {
        self.frames_until_next_analysis + self.fft_size <= self.input_write_pos
    }

    pub fn process_one_frame(&mut self) {
        if !self.can_process_frame() { return; }
        let rs = self.frames_until_next_analysis;
        self.analyze_frame(rs);
        self.update_phase_master();
        self.synthesize_frame();
        self.frames_until_next_analysis += self.analysis_hop;
    }

    /// Process one frame using another channel's phases as reference,
    /// preserving the inter-channel phase difference (stereo image).
    pub fn process_one_frame_locked(&mut self, ref_synth: &[f32], ref_analysis: &[f32]) {
        if !self.can_process_frame() { return; }
        let rs = self.frames_until_next_analysis;
        self.analyze_frame(rs);
        self.update_phase_locked(ref_synth, ref_analysis);
        self.synthesize_frame();
        self.frames_until_next_analysis += self.analysis_hop;
    }

    pub fn finish_processing(&mut self) {
        self.compact_input();
    }

    pub fn synthesis_phases(&self) -> &[f32] {
        &self.synthesis_phase
    }

    pub fn analysis_phases(&self) -> &[f32] {
        &self.analysis_phase
    }


    pub fn output_available(&self) -> usize {
        self.output_accum_len.saturating_sub(self.output_read_pos)
    }

    pub fn read_output(&mut self, dest: &mut [f32], max: usize) -> usize {
        let avail = self.output_available().min(max).min(dest.len());
        if avail == 0 { return 0; }
        dest[..avail].copy_from_slice(
            &self.output_accum[self.output_read_pos..self.output_read_pos + avail]
        );
        self.output_read_pos += avail;
        self.compact_output();
        avail
    }

    fn analyze_frame(&mut self, read_start: usize) {
        let n = self.fft_size;
        let half = n / 2 + 1;

        for i in 0..n {
            self.frame_re[i] = self.input_buf[read_start + i] * self.window[i];
            self.frame_im[i] = 0.0;
        }
        self.fft.forward(&mut self.frame_re, &mut self.frame_im);

        for k in 0..half {
            let re = self.frame_re[k];
            let im = self.frame_im[k];
            self.magnitude[k] = (re * re + im * im).sqrt();
            self.analysis_phase[k] = im.atan2(re);
        }
    }

    fn update_phase_master(&mut self) {
        let half = self.fft_size / 2 + 1;

        if self.first_frame {
            self.synthesis_phase.copy_from_slice(&self.analysis_phase);
            self.first_frame = false;
        } else {
            let ha = self.analysis_hop as f32;
            let hs = self.synthesis_hop as f32;
            let expected_phase_advance_per_bin = TWO_PI * ha / self.fft_size as f32;

            self.detect_peaks(half);
            self.prev_synth_phase.copy_from_slice(&self.synthesis_phase);

            for k in 0..half {
                if !self.peak_flags[k] {
                    continue;
                }
                let phase_diff = self.analysis_phase[k] - self.prev_analysis_phase[k];
                let expected = expected_phase_advance_per_bin * k as f32;
                let deviation = wrap_phase(phase_diff - expected);
                let inst_freq = expected + deviation;
                let synth_advance = inst_freq * (hs / ha);
                self.synthesis_phase[k] = wrap_phase(self.prev_synth_phase[k] + synth_advance);
            }

            self.propagate_phase_from_peaks(half);
        }

        self.prev_analysis_phase.copy_from_slice(&self.analysis_phase);
    }

    /// Preserve inter-channel phase difference: synth_R[k] = synth_L[k] + (analysis_R[k] - analysis_L[k])
    fn update_phase_locked(&mut self, ref_synth: &[f32], ref_analysis: &[f32]) {
        let half = self.fft_size / 2 + 1;

        for k in 0..half {
            let delta = self.analysis_phase[k] - ref_analysis[k];
            self.synthesis_phase[k] = wrap_phase(ref_synth[k] + delta);
        }

        self.prev_analysis_phase.copy_from_slice(&self.analysis_phase);
        self.first_frame = false;
    }

    fn synthesize_frame(&mut self) {
        let n = self.fft_size;
        let half = n / 2 + 1;

        for k in 0..half {
            let mag = self.magnitude[k];
            let ph = self.synthesis_phase[k];
            self.frame_re[k] = mag * ph.cos();
            self.frame_im[k] = mag * ph.sin();
        }
        for k in 1..n / 2 {
            self.frame_re[n - k] = self.frame_re[k];
            self.frame_im[n - k] = -self.frame_im[k];
        }

        self.fft.inverse(&mut self.frame_re, &mut self.frame_im);

        let synth_hop = self.synthesis_hop;
        let write_start = self.output_accum_len;
        let needed = write_start + n;
        if needed > self.output_accum.len() {
            self.output_accum.resize(needed + synth_hop * 8, 0.0);
        }

        let norm = &self.norm_array;
        let norm_len = norm.len();
        let mut r = 0usize;
        for i in 0..n {
            self.output_accum[write_start + i] +=
                self.frame_re[i] * self.window[i] * norm[r];
            r += 1;
            if r >= norm_len { r = 0; }
        }

        self.output_accum_len += synth_hop;
    }

    fn detect_peaks(&mut self, half: usize) {
        self.peak_flags[0] = self.magnitude[0] >= self.magnitude[1];
        for k in 1..half - 1 {
            self.peak_flags[k] = self.magnitude[k] >= self.magnitude[k - 1]
                && self.magnitude[k] >= self.magnitude[k + 1];
        }
        self.peak_flags[half - 1] = self.magnitude[half - 1] >= self.magnitude[half - 2];
    }

    fn propagate_phase_from_peaks(&mut self, half: usize) {
        let mut nearest_peak = 0usize;
        let mut dist_to_peak = half;

        for k in 0..half {
            if self.peak_flags[k] {
                nearest_peak = k;
                dist_to_peak = 0;
            }
            self.assigned_peak[k] = nearest_peak;
            self.assigned_dist[k] = dist_to_peak;
            dist_to_peak += 1;
        }

        nearest_peak = half - 1;
        dist_to_peak = half;
        for k in (0..half).rev() {
            if self.peak_flags[k] {
                nearest_peak = k;
                dist_to_peak = 0;
            }
            if dist_to_peak < self.assigned_dist[k] {
                self.assigned_peak[k] = nearest_peak;
            }
            dist_to_peak += 1;
        }

        for k in 0..half {
            if self.peak_flags[k] {
                continue;
            }
            let pk = self.assigned_peak[k];
            let peak_phase_rotation = self.synthesis_phase[pk] - self.analysis_phase[pk];
            self.synthesis_phase[k] = wrap_phase(self.analysis_phase[k] + peak_phase_rotation);
        }
    }

    fn compact_input(&mut self) {
        let consumed = self.frames_until_next_analysis.saturating_sub(self.fft_size);
        if consumed > 0 && consumed <= self.input_write_pos {
            self.input_buf.copy_within(consumed..self.input_write_pos, 0);
            self.input_write_pos -= consumed;
            self.frames_until_next_analysis -= consumed;
        }
    }

    fn compact_output(&mut self) {
        if self.output_read_pos > 0 {
            let remaining = self.output_accum.len() - self.output_read_pos;
            self.output_accum.copy_within(self.output_read_pos.., 0);
            if self.output_accum_len >= self.output_read_pos {
                self.output_accum_len -= self.output_read_pos;
            } else {
                self.output_accum_len = 0;
            }
            for i in remaining..self.output_accum.len() {
                self.output_accum[i] = 0.0;
            }
            self.output_read_pos = 0;
        }
    }
}

/// Compute per-sample COLA normalization for Hann² overlap-add.
///
/// For synthesis hop Hs, the overlap-add sum at output position p depends on
/// p mod Hs. We compute: norm[r] = 1 / ∑_k w²(r + k*Hs) for r = 0..Hs-1.
/// Uses f64 accumulation to minimize rounding error.
fn compute_norm_array(window: &[f32], synth_hop: usize) -> Vec<f32> {
    let n = window.len();
    (0..synth_hop)
        .map(|r| {
            let mut sum = 0.0f64;
            let mut idx = r;
            while idx < n {
                let w = window[idx] as f64;
                sum += w * w;
                idx += synth_hop;
            }
            if sum > 1e-10 { (1.0 / sum) as f32 } else { 0.0 }
        })
        .collect()
}

#[inline]
fn wrap_phase(phase: f32) -> f32 {
    phase - TWO_PI * ((phase + PI) / TWO_PI).floor()
}
