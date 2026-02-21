use core::f32::consts::PI;

/// In-place radix-2 Cooley-Tukey FFT/IFFT for f32 complex pairs.
/// `re` and `im` must have equal power-of-2 length.
pub struct Fft {
    n: usize,
    log2n: u32,
    twiddle_re: Vec<f32>,
    twiddle_im: Vec<f32>,
}

impl Fft {
    pub fn new(n: usize) -> Self {
        debug_assert!(n.is_power_of_two() && n >= 2);
        let log2n = n.trailing_zeros();
        let half = n / 2;
        let mut twiddle_re = vec![0.0f32; half];
        let mut twiddle_im = vec![0.0f32; half];
        for k in 0..half {
            let angle = -2.0 * PI * k as f32 / n as f32;
            twiddle_re[k] = angle.cos();
            twiddle_im[k] = angle.sin();
        }
        Self { n, log2n, twiddle_re, twiddle_im }
    }

    /// Forward FFT in-place.
    pub fn forward(&self, re: &mut [f32], im: &mut [f32]) {
        self.bit_reverse_permute(re, im);
        self.butterfly_passes(re, im, false);
    }

    /// Inverse FFT in-place (includes 1/N scaling).
    pub fn inverse(&self, re: &mut [f32], im: &mut [f32]) {
        self.bit_reverse_permute(re, im);
        self.butterfly_passes(re, im, true);
        let inv = 1.0 / self.n as f32;
        for i in 0..self.n {
            re[i] *= inv;
            im[i] *= inv;
        }
    }

    fn bit_reverse_permute(&self, re: &mut [f32], im: &mut [f32]) {
        let n = self.n;
        let mut j = 0usize;
        for i in 1..n {
            let mut bit = n >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
    }

    fn butterfly_passes(&self, re: &mut [f32], im: &mut [f32], inverse: bool) {
        let n = self.n;
        for s in 0..self.log2n {
            let m = 1 << (s + 1);
            let half_m = m >> 1;
            let tw_stride = n / m;

            let mut k = 0;
            while k < n {
                for j in 0..half_m {
                    let tw_idx = j * tw_stride;
                    let wr = self.twiddle_re[tw_idx];
                    let wi = if inverse { -self.twiddle_im[tw_idx] } else { self.twiddle_im[tw_idx] };

                    let a = k + j;
                    let b = a + half_m;

                    let tr = wr * re[b] - wi * im[b];
                    let ti = wr * im[b] + wi * re[b];

                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
                k += m;
            }
        }
    }
}
