/// Automatic Gain Control (AGC) for stereo interleaved audio.
///
/// Tracks the signal envelope with asymmetric attack/release and applies
/// a smoothed gain to bring the output toward a target peak level.
/// A per-sample limiter guarantees output never exceeds ±1.0.
/// Does not affect pitch.
pub struct Agc {
    enabled: bool,
    env_level: f32,
    current_gain: f32,
    target_level: f32,
    attack_coeff: f32,
    release_coeff: f32,
    gain_smooth_coeff: f32,
    max_gain: f32,
    min_gain: f32,
}

impl Agc {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            enabled: false,
            env_level: 0.0,
            current_gain: 1.0,
            target_level: 0.7,
            attack_coeff: 1.0 - (-1.0 / (sample_rate * 0.005)).exp(),
            release_coeff: 1.0 - (-1.0 / (sample_rate * 0.300)).exp(),
            gain_smooth_coeff: 1.0 - (-1.0 / (sample_rate * 0.050)).exp(),
            max_gain: 4.0,
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

            let coeff = if peak > self.env_level {
                self.attack_coeff
            } else {
                self.release_coeff
            };
            self.env_level += coeff * (peak - self.env_level);

            let desired_gain = if self.env_level > 1e-6 {
                (self.target_level / self.env_level).clamp(self.min_gain, self.max_gain)
            } else {
                1.0
            };

            self.current_gain += self.gain_smooth_coeff * (desired_gain - self.current_gain);

            // Per-sample limiter: cap gain so output never exceeds ±1.0
            let safe_gain = if peak > 1e-6 {
                self.current_gain.min(1.0 / peak)
            } else {
                self.current_gain
            };

            buf[i * 2] = l * safe_gain;
            buf[i * 2 + 1] = r * safe_gain;
        }
    }
}
