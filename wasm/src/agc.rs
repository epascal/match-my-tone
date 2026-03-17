/// Automatic Gain Control (AGC) for stereo interleaved audio.
///
/// Tracks the signal envelope with asymmetric attack/release and applies
/// a smoothed gain to bring the output toward a target peak level.
/// Gain reduction is near-instantaneous (5 ms) while gain increase is
/// gradual (200 ms), preventing pumping artifacts on transients.
/// A per-sample limiter guarantees output never exceeds ±0.98.
/// Does not affect pitch.
pub struct Agc {
    enabled: bool,
    env_level: f32,
    current_gain: f32,
    target_level: f32,
    env_attack: f32,
    env_release: f32,
    gain_attack: f32,
    gain_release: f32,
    max_gain: f32,
    min_gain: f32,
}

const CEILING: f32 = 0.98;

impl Agc {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            enabled: false,
            env_level: 0.0,
            current_gain: 1.0,
            target_level: 0.7,
            env_attack: 1.0 - (-1.0 / (sample_rate * 0.003)).exp(),
            env_release: 1.0 - (-1.0 / (sample_rate * 0.300)).exp(),
            gain_attack: 1.0 - (-1.0 / (sample_rate * 0.005)).exp(),
            gain_release: 1.0 - (-1.0 / (sample_rate * 0.200)).exp(),
            max_gain: 2.0,
            min_gain: 0.25,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        if self.enabled && !enabled {
            self.current_gain = 1.0;
            self.env_level = 0.0;
        }
        self.enabled = enabled;
    }

    #[allow(dead_code)]
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Process interleaved stereo samples in-place.
    /// `num_frames` is the number of stereo frames (buf length = num_frames * 2).
    pub fn process_interleaved(&mut self, buf: &mut [f32], num_frames: usize) {
        if !self.enabled {
            return;
        }

        for i in 0..num_frames {
            let l = buf[i * 2];
            let r = buf[i * 2 + 1];
            let peak = l.abs().max(r.abs());

            let env_coeff = if peak > self.env_level {
                self.env_attack
            } else {
                self.env_release
            };
            self.env_level += env_coeff * (peak - self.env_level);

            let desired_gain = if self.env_level > 1e-6 {
                (self.target_level / self.env_level).clamp(self.min_gain, self.max_gain)
            } else {
                1.0
            };

            let gain_coeff = if desired_gain < self.current_gain {
                self.gain_attack
            } else {
                self.gain_release
            };
            self.current_gain += gain_coeff * (desired_gain - self.current_gain);

            let safe_gain = if peak > 1e-6 {
                self.current_gain.min(CEILING / peak)
            } else {
                self.current_gain
            };

            buf[i * 2] = l * safe_gain;
            buf[i * 2 + 1] = r * safe_gain;
        }
    }
}
