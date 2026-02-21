mod fft;
mod fifo_buffer;
mod phase_vocoder;
mod pitch_shifter;
mod resampler;

use pitch_shifter::PitchShifter;
use std::alloc::{alloc, dealloc, Layout};

// ---- Memory management for JS interop ----

#[no_mangle]
pub extern "C" fn wasm_alloc(size: u32) -> *mut u8 {
    let layout = Layout::from_size_align(size as usize, 4).unwrap();
    unsafe { alloc(layout) }
}

#[no_mangle]
pub extern "C" fn wasm_dealloc(ptr: *mut u8, size: u32) {
    let layout = Layout::from_size_align(size as usize, 4).unwrap();
    unsafe { dealloc(ptr, layout) }
}

// ---- PitchShifter lifecycle (same FFI names for backward compat) ----

#[no_mangle]
pub extern "C" fn soundtouch_new(sample_rate: f32) -> *mut PitchShifter {
    let ps = Box::new(PitchShifter::new(sample_rate));
    Box::into_raw(ps)
}

#[no_mangle]
pub extern "C" fn soundtouch_free(ptr: *mut PitchShifter) {
    if !ptr.is_null() {
        unsafe {
            drop(Box::from_raw(ptr));
        }
    }
}

// ---- Parameter setters ----

#[no_mangle]
pub extern "C" fn soundtouch_set_rate(ptr: *mut PitchShifter, rate: f32) {
    let ps = unsafe { &mut *ptr };
    ps.set_rate(rate);
}

#[no_mangle]
pub extern "C" fn soundtouch_set_tempo(ptr: *mut PitchShifter, tempo: f32) {
    let ps = unsafe { &mut *ptr };
    ps.set_tempo(tempo);
}

#[no_mangle]
pub extern "C" fn soundtouch_set_pitch(ptr: *mut PitchShifter, pitch: f32) {
    let ps = unsafe { &mut *ptr };
    ps.set_pitch(pitch);
}

// ---- Audio processing ----

#[no_mangle]
pub extern "C" fn soundtouch_put_samples(ptr: *mut PitchShifter, input_ptr: *const f32, num_frames: u32) {
    let ps = unsafe { &mut *ptr };
    let samples = unsafe { std::slice::from_raw_parts(input_ptr, num_frames as usize * 2) };
    ps.put_samples(samples, num_frames as usize);
}

#[no_mangle]
pub extern "C" fn soundtouch_process(ptr: *mut PitchShifter) {
    let ps = unsafe { &mut *ptr };
    ps.process();
}

#[no_mangle]
pub extern "C" fn soundtouch_receive_samples(ptr: *mut PitchShifter, output_ptr: *mut f32, max_frames: u32) -> u32 {
    let ps = unsafe { &mut *ptr };
    let output = unsafe { std::slice::from_raw_parts_mut(output_ptr, max_frames as usize * 2) };
    ps.receive_samples(output, max_frames as usize) as u32
}

#[no_mangle]
pub extern "C" fn soundtouch_clear(ptr: *mut PitchShifter) {
    let ps = unsafe { &mut *ptr };
    ps.clear();
}
