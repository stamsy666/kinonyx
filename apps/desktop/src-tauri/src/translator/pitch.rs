//! The speaker's likely gender from the pitch of their voice — a hint for the translator.
//!
//! Russian marks the speaker's gender where English doesn't («я устал» / «я устала»), so a
//! line translated without knowing who says it is wrong half the time. A median fundamental
//! frequency is a crude but cheap signal: adult male speech sits around 85–155 Hz, female
//! around 165–255 Hz. Between the two, or with too little voiced audio, we say nothing and
//! the translator falls back to context.
//!
//! Input: mono f32 at any rate (the pipeline's is 24 kHz). It is decimated to ~12 kHz and at
//! most `MAX_ANALYSIS_S` from the middle of the clip is looked at, so a segment costs well under
//! a millisecond in release builds.

use super::mt::Gender;

const FRAME_S: f32 = 0.040;
const HOP_S: f32 = 0.020;
const F_MIN: f32 = 60.0;
const F_MAX: f32 = 400.0;
/// YIN threshold on the cumulative-mean-normalised difference.
const YIN_THRESHOLD: f32 = 0.15;
/// Less voiced audio than this and the answer is "don't know".
const MIN_VOICED_S: f32 = 0.5;
const MAX_ANALYSIS_S: f32 = 4.0;
/// Analysis rate: plenty for pitch up to 400 Hz.
const TARGET_SR: u32 = 12_000;

/// F0 of one frame (YIN), or None if the frame is unvoiced or silent.
fn frame_f0(x: &[f32], sr: f32) -> Option<f32> {
    let energy = x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32;
    if energy < 1e-5 {
        return None;
    }
    let tau_min = ((sr / F_MAX) as usize).max(2);
    let tau_max = ((sr / F_MIN) as usize).min(x.len() / 2);
    if tau_max <= tau_min + 2 {
        return None;
    }
    let w = x.len() - tau_max;
    let mut d = vec![0f32; tau_max + 1];
    for (tau, slot) in d.iter_mut().enumerate().skip(1) {
        let mut s = 0f32;
        for j in 0..w {
            let diff = x[j] - x[j + tau];
            s += diff * diff;
        }
        *slot = s;
    }
    let mut cmnd = vec![1f32; tau_max + 1];
    let mut running = 0f32;
    for tau in 1..=tau_max {
        running += d[tau];
        cmnd[tau] = if running > 0.0 { d[tau] * tau as f32 / running } else { 1.0 };
    }
    let mut tau = tau_min;
    while tau < tau_max {
        if cmnd[tau] < YIN_THRESHOLD {
            while tau + 1 < tau_max && cmnd[tau + 1] < cmnd[tau] {
                tau += 1;
            }
            let (a, b, c) = (cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]);
            let den = a - 2.0 * b + c;
            let shift = if den.abs() > 1e-9 { 0.5 * (a - c) / den } else { 0.0 };
            return Some(sr / (tau as f32 + shift.clamp(-1.0, 1.0)));
        }
        tau += 1;
    }
    None
}

/// Box-filter decimation by an integer factor (enough anti-aliasing for a pitch estimate).
fn decimate(samples: &[f32], factor: usize) -> Vec<f32> {
    if factor <= 1 {
        return samples.to_vec();
    }
    samples.chunks_exact(factor).map(|c| c.iter().sum::<f32>() / factor as f32).collect()
}

/// Median F0 over the voiced frames, if there are enough of them.
pub fn median_f0(samples: &[f32], sample_rate: u32) -> Option<f32> {
    let factor = (sample_rate / TARGET_SR).max(1) as usize;
    let sr = sample_rate as f32 / factor as f32;
    // The middle of the clip: its edges are often breath, music or the previous speaker.
    let keep = (MAX_ANALYSIS_S * sample_rate as f32) as usize;
    let clip = if samples.len() > keep {
        let start = (samples.len() - keep) / 2;
        &samples[start..start + keep]
    } else {
        samples
    };
    let x = decimate(clip, factor);
    let (frame, hop) = ((FRAME_S * sr) as usize, (HOP_S * sr) as usize);
    let mut f0s: Vec<f32> = Vec::new();
    let mut i = 0;
    while i + frame <= x.len() {
        if let Some(f) = frame_f0(&x[i..i + frame], sr) {
            f0s.push(f);
        }
        i += hop.max(1);
    }
    if (f0s.len() as f32) * HOP_S < MIN_VOICED_S {
        return None;
    }
    f0s.sort_by(f32::total_cmp);
    Some(f0s[f0s.len() / 2])
}

pub fn gender_from_f0(f0: f32) -> Option<Gender> {
    if f0 < 155.0 {
        Some(Gender::Male)
    } else if f0 > 175.0 {
        Some(Gender::Female)
    } else {
        None
    }
}

pub fn speaker_gender(samples: &[f32], sample_rate: u32) -> Option<Gender> {
    median_f0(samples, sample_rate).and_then(gender_from_f0)
}

/// One answer for a group of segments: the majority of those that have one.
pub fn majority(genders: impl IntoIterator<Item = Option<Gender>>) -> Option<Gender> {
    let (mut m, mut f) = (0, 0);
    for g in genders.into_iter().flatten() {
        match g {
            Gender::Male => m += 1,
            Gender::Female => f += 1,
        }
    }
    match m.cmp(&f) {
        std::cmp::Ordering::Greater => Some(Gender::Male),
        std::cmp::Ordering::Less => Some(Gender::Female),
        std::cmp::Ordering::Equal => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A buzzy vowel-like tone: harmonics with falling amplitude, slight vibrato.
    fn voice(f0: f32, secs: f32, sr: u32) -> Vec<f32> {
        let n = (secs * sr as f32) as usize;
        let mut phase = 0f32;
        (0..n)
            .map(|i| {
                let t = i as f32 / sr as f32;
                let f = f0 * (1.0 + 0.02 * (2.0 * std::f32::consts::PI * 5.0 * t).sin());
                phase += 2.0 * std::f32::consts::PI * f / sr as f32;
                (1..=8).map(|h| (phase * h as f32).sin() / h as f32).sum::<f32>() * 0.2
            })
            .collect()
    }

    fn noise(n: usize) -> Vec<f32> {
        let mut s = 12345u32;
        (0..n)
            .map(|_| {
                s = s.wrapping_mul(1664525).wrapping_add(1013904223);
                (s as f32 / u32::MAX as f32 - 0.5) * 0.2
            })
            .collect()
    }

    #[test]
    fn finds_the_pitch_of_a_tone_at_the_pipeline_rates() {
        for sr in [16_000, 24_000, 48_000] {
            for f in [95.0, 120.0, 210.0, 250.0] {
                let m = median_f0(&voice(f, 1.0, sr), sr).unwrap();
                assert!((m - f).abs() / f < 0.04, "{sr} Hz: {f} -> {m}");
            }
        }
    }

    #[test]
    fn low_voice_is_male_high_is_female_middle_is_unknown() {
        assert_eq!(speaker_gender(&voice(110.0, 1.0, 24_000), 24_000), Some(Gender::Male));
        assert_eq!(speaker_gender(&voice(220.0, 1.0, 24_000), 24_000), Some(Gender::Female));
        assert_eq!(speaker_gender(&voice(165.0, 1.0, 24_000), 24_000), None);
    }

    #[test]
    fn silence_noise_and_short_clips_say_nothing() {
        assert_eq!(speaker_gender(&vec![0.0; 24_000], 24_000), None);
        assert_eq!(speaker_gender(&noise(24_000), 24_000), None);
        assert_eq!(speaker_gender(&voice(110.0, 0.3, 24_000), 24_000), None);
    }

    #[test]
    fn long_clips_are_cut_to_the_middle() {
        let mut v = voice(220.0, 2.0, 24_000);
        v.extend(voice(110.0, 6.0, 24_000));
        v.extend(voice(220.0, 2.0, 24_000));
        assert_eq!(speaker_gender(&v, 24_000), Some(Gender::Male));
    }

    #[test]
    fn majority_vote() {
        use Gender::*;
        assert_eq!(majority([Some(Male), None, Some(Male), Some(Female)]), Some(Male));
        assert_eq!(majority([Some(Female), None]), Some(Female));
        assert_eq!(majority([Some(Male), Some(Female)]), None);
        assert_eq!(majority([None, None]), None);
    }
}
