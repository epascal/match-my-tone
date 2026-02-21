use core::f32::consts::PI;

const ZERO_CROSSINGS: usize = 8;
const KAISER_BETA: f32 = 6.0;
const TABLE_STEPS_PER_CROSSING: usize = 128;
const TABLE_LEN: usize = ZERO_CROSSINGS * TABLE_STEPS_PER_CROSSING + 1;

/// High-quality windowed sinc resampler.
///
/// `ratio` = input samples consumed per output sample produced.
///   ratio > 1 → fewer outputs (pitch up / speed up)
///   ratio < 1 → more outputs (pitch down / slow down)
///   ratio = 1 → pass-through
pub struct SincResampler {
    ratio: f64,
    buf: Vec<f32>,
    buf_len: usize,
    read_pos: f64,
    sinc_table: Vec<f32>,
}

impl SincResampler {
    pub fn new() -> Self {
        let mut buf = vec![0.0f32; 4096];
        let _ = &buf[..ZERO_CROSSINGS]; // zero-padded prefix
        Self {
            ratio: 1.0,
            buf,
            buf_len: ZERO_CROSSINGS,
            read_pos: ZERO_CROSSINGS as f64,
            sinc_table: build_sinc_table(),
        }
    }

    pub fn set_ratio(&mut self, ratio: f32) {
        self.ratio = ratio.max(0.01) as f64;
    }

    pub fn clear(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
        self.buf_len = ZERO_CROSSINGS;
        self.read_pos = ZERO_CROSSINGS as f64;
    }

    pub fn push_input(&mut self, samples: &[f32]) {
        let needed = self.buf_len + samples.len();
        if needed > self.buf.len() {
            self.buf.resize(needed * 2, 0.0);
        }
        self.buf[self.buf_len..self.buf_len + samples.len()].copy_from_slice(samples);
        self.buf_len += samples.len();
    }

    pub fn read_output(&mut self, dest: &mut [f32], max: usize) -> usize {
        let max = max.min(dest.len());
        let mut out_count = 0;
        let wing = ZERO_CROSSINGS as isize;

        while out_count < max {
            let int_pos = self.read_pos.floor() as isize;
            let frac = (self.read_pos - int_pos as f64) as f32;

            // We need samples from (int_pos - wing + 1) to (int_pos + wing) inclusive
            let left_bound = int_pos - wing + 1;
            let right_bound = int_pos + wing;

            if left_bound < 0 || right_bound >= self.buf_len as isize {
                break;
            }

            dest[out_count] = self.interpolate(int_pos as usize, frac);
            out_count += 1;
            self.read_pos += self.ratio;
        }

        self.compact();
        out_count
    }

    fn interpolate(&self, int_pos: usize, frac: f32) -> f32 {
        let mut sum = 0.0f32;
        let scale = TABLE_STEPS_PER_CROSSING as f32;

        // Left wing: samples at int_pos, int_pos-1, ..., int_pos - ZERO_CROSSINGS + 1
        // Distances: frac, 1+frac, 2+frac, ...
        for i in 0..ZERO_CROSSINGS {
            let distance = i as f32 + frac;
            let table_idx = (distance * scale + 0.5) as usize;
            if table_idx < TABLE_LEN {
                sum += self.buf[int_pos - i] * self.sinc_table[table_idx];
            }
        }

        // Right wing: samples at int_pos+1, int_pos+2, ..., int_pos + ZERO_CROSSINGS
        // Distances: 1-frac, 2-frac, 3-frac, ...
        for i in 0..ZERO_CROSSINGS {
            let distance = (i + 1) as f32 - frac;
            let table_idx = (distance * scale + 0.5) as usize;
            if table_idx < TABLE_LEN {
                sum += self.buf[int_pos + 1 + i] * self.sinc_table[table_idx];
            }
        }

        sum
    }

    fn compact(&mut self) {
        let consumed = self.read_pos.floor() as usize;
        let keep_margin = ZERO_CROSSINGS;
        if consumed > keep_margin {
            let shift = consumed - keep_margin;
            self.buf.copy_within(shift..self.buf_len, 0);
            self.buf_len -= shift;
            self.read_pos -= shift as f64;
        }
    }
}

fn build_sinc_table() -> Vec<f32> {
    let mut table = vec![0.0f32; TABLE_LEN];
    for i in 0..TABLE_LEN {
        let x = i as f32 / TABLE_STEPS_PER_CROSSING as f32;
        let sinc = if x < 1e-6 { 1.0 } else { (PI * x).sin() / (PI * x) };
        let window = kaiser(x / ZERO_CROSSINGS as f32, KAISER_BETA);
        table[i] = sinc * window;
    }
    table
}

fn kaiser(x: f32, beta: f32) -> f32 {
    if x.abs() > 1.0 { return 0.0; }
    bessel_i0(beta * (1.0 - x * x).max(0.0).sqrt()) / bessel_i0(beta)
}

fn bessel_i0(x: f32) -> f32 {
    let mut sum = 1.0f64;
    let mut term = 1.0f64;
    let x = x as f64;
    for k in 1..25 {
        term *= (x / 2.0) / k as f64;
        term *= (x / 2.0) / k as f64;
        sum += term;
        if term < sum * 1e-12 { break; }
    }
    sum as f32
}
