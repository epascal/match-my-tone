const CHANNELS: usize = 2;

/// FIFO buffer for stereo interleaved audio frames.
///
/// Storage: `vector` contains interleaved samples [L0,R0,L1,R1,...],
/// and we reason in "frames" (1 frame = 2 samples: L + R).
pub struct FifoSampleBuffer {
    vector: Vec<f32>,
    position_frames: usize,
    frame_count: usize,
}

impl FifoSampleBuffer {
    pub fn new() -> Self {
        Self {
            vector: Vec::new(),
            position_frames: 0,
            frame_count: 0,
        }
    }

    #[inline]
    pub fn vector(&self) -> &[f32] {
        &self.vector
    }

    #[inline]
    pub fn vector_mut(&mut self) -> &mut [f32] {
        &mut self.vector
    }

    #[inline]
    pub fn position_frames(&self) -> usize {
        self.position_frames
    }

    #[inline]
    pub fn start_index(&self) -> usize {
        self.position_frames * CHANNELS
    }

    #[inline]
    pub fn frame_count(&self) -> usize {
        self.frame_count
    }

    #[inline]
    pub fn end_index(&self) -> usize {
        (self.position_frames + self.frame_count) * CHANNELS
    }

    pub fn clear(&mut self) {
        let fc = self.frame_count;
        self.receive(fc);
        self.rewind();
    }

    /// Marks `num_frames` frames as written (after direct writes into `vector`).
    #[inline]
    pub fn put(&mut self, num_frames: usize) {
        self.frame_count += num_frames;
    }

    /// Appends interleaved samples from `samples[position_frames*2 ..]`.
    pub fn put_samples(&mut self, samples: &[f32], position_frames: usize, num_frames_hint: isize) {
        let source_offset = position_frames * CHANNELS;
        let frames = if num_frames_hint >= 0 {
            num_frames_hint as usize
        } else {
            (samples.len() - source_offset) / CHANNELS
        };
        let num_samples = frames * CHANNELS;

        self.ensure_capacity(self.frame_count + frames);

        let dest_offset = self.end_index();
        self.vector[dest_offset..dest_offset + num_samples]
            .copy_from_slice(&samples[source_offset..source_offset + num_samples]);
        self.frame_count += frames;
    }

    /// Copies frames from another FIFO buffer.
    pub fn put_buffer(&mut self, other: &FifoSampleBuffer, position_frames: usize, num_frames_hint: isize) {
        let frames = if num_frames_hint >= 0 {
            num_frames_hint as usize
        } else {
            other.frame_count - position_frames
        };
        let src_pos = other.position_frames + position_frames;
        let src_offset = src_pos * CHANNELS;
        let num_samples = frames * CHANNELS;

        self.ensure_capacity(self.frame_count + frames);

        let dest_offset = self.end_index();
        self.vector[dest_offset..dest_offset + num_samples]
            .copy_from_slice(&other.vector[src_offset..src_offset + num_samples]);
        self.frame_count += frames;
    }

    /// Consumes `num_frames` frames from the front.
    pub fn receive(&mut self, num_frames: usize) {
        let frames = num_frames.min(self.frame_count);
        self.frame_count -= frames;
        self.position_frames += frames;
    }

    /// Copies `num_frames` interleaved frames into `output`, then consumes them.
    pub fn receive_samples(&mut self, output: &mut [f32], num_frames: usize) {
        let num_samples = num_frames * CHANNELS;
        let src_offset = self.start_index();
        output[..num_samples].copy_from_slice(&self.vector[src_offset..src_offset + num_samples]);
        self.receive(num_frames);
    }

    pub fn ensure_capacity(&mut self, num_frames: usize) {
        let min_length = num_frames * CHANNELS;
        if self.vector.len() < min_length {
            let current_length = self.vector.len();
            let new_length = min_length.max(if current_length == 0 { 1024 } else { current_length * 2 });
            let mut new_vector = vec![0.0f32; new_length];

            let start = self.start_index();
            let end = self.end_index();
            new_vector[..end - start].copy_from_slice(&self.vector[start..end]);
            self.vector = new_vector;
            self.position_frames = 0;
            return;
        }

        self.rewind();
    }

    pub fn ensure_additional_capacity(&mut self, num_frames: usize) {
        self.ensure_capacity(self.frame_count + num_frames);
    }

    fn rewind(&mut self) {
        if self.position_frames == 0 {
            return;
        }
        let start = self.start_index();
        let end = self.end_index();
        self.vector.copy_within(start..end, 0);
        self.position_frames = 0;
    }
}
