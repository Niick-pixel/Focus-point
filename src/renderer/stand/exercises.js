// Standing pelvic-floor routine. Each exercise is a timeline: at(t) returns
//   { floor, pose, cue, count }
//   floor  -0.3..1   pelvic floor lift (negative = consciously softening/descending)
//   pose             see StandVisuals.Figure
//   cue              short live instruction
//   count            e.g. "Rep 2 of 5" (optional)
//
// General wellness guidance, not medical advice. The routine alternates lifting with
// complete release: for people who sit all day, letting go matters as much as squeezing.
(function () {
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const ramp = (t, a, b) => ease((t - a) / (b - a));
  const TAU = Math.PI * 2;
  const pose = (extra = {}) => ({ squat: 0, heel: 0, tilt: 0, swayX: 0, swayY: 0, march: 0, arms: 'hang', reach: 0, ...extra });

  /** Repeat a rep function `reps` times, each `len` seconds long. */
  function reps(total, len, fn) {
    return (t) => {
      const i = Math.min(total - 1, Math.floor(t / len));
      const r = fn(t - i * len, i);
      return { ...r, count: `${i + 1} of ${total}` };
    };
  }

  const EXERCISES = {
    find: {
      title: 'Find your pelvic floor',
      how: 'Stand tall, feet hip-width, knees soft. Imagine stopping the flow of urine and holding in wind at the same time — that gentle inward lift is your pelvic floor. Keep your glutes, thighs and belly relaxed.',
      secs: 36,
      at: (t) => {
        const c = t % 6;
        const exhale = c >= 3;
        const floor = exhale ? 0.75 * ramp(c, 3, 4.6) : 0.75 * (1 - ramp(c, 0, 1.6));
        return { floor, pose: pose(), cue: exhale ? 'Breathe out — gently lift' : 'Breathe in — let it soften' };
      },
    },

    holds: {
      title: 'Long holds',
      how: 'Lift and hold for 5 seconds while breathing normally, then let go completely. The release is part of the exercise.',
      secs: 50,
      at: reps(5, 10, (t) => {
        const floor = ramp(t, 0, 1) * (1 - ramp(t, 6, 7));
        let cue = 'Rest — fully relaxed';
        if (t < 1) cue = 'Lift';
        else if (t < 6) cue = `Hold… ${Math.ceil(6 - t)}`;
        else if (t < 7) cue = 'Release';
        return { floor, pose: pose(), cue };
      }),
    },

    flicks: {
      title: 'Quick flicks',
      how: 'Short, quick squeezes and full releases. These train the fast muscle fibres that react when you cough, sneeze or lift.',
      secs: 20,
      at: reps(10, 2, (t) => {
        const floor = t < 0.35 ? ramp(t, 0, 0.3) : 1 - ramp(t, 0.35, 0.75);
        return { floor, pose: pose(), cue: t < 0.6 ? 'Squeeze' : 'Release' };
      }),
    },

    elevator: {
      title: 'The elevator',
      how: 'Lift in three steps like an elevator going up floor by floor, then lower it one floor at a time. Slow and controlled.',
      secs: 36,
      at: reps(3, 12, (t) => {
        const steps = [0.33, 0.66, 1];
        let floor = 0;
        let cue = 'Rest';
        if (t < 4.5) {
          const i = Math.min(2, Math.floor(t / 1.5));
          floor = (i ? steps[i - 1] : 0) + (steps[i] - (i ? steps[i - 1] : 0)) * ramp(t - i * 1.5, 0, 0.7);
          cue = `Up — floor ${i + 1}`;
        } else if (t < 9) {
          const i = Math.min(2, Math.floor((t - 4.5) / 1.5));
          const from = steps[2 - i];
          const to = i === 2 ? 0 : steps[1 - i];
          floor = from + (to - from) * ramp(t - 4.5 - i * 1.5, 0, 0.7);
          cue = `Down — floor ${3 - i}`;
        }
        return { floor, pose: pose(), cue };
      }),
    },

    squats: {
      title: 'Mini squats',
      how: 'Sit back into a shallow squat as you breathe in. Breathe out, lift your pelvic floor and push the floor away to stand. Knees track over your toes.',
      secs: 40,
      at: reps(8, 5, (t) => {
        const down = t < 2.5;
        const squat = down ? 0.55 * ramp(t, 0, 2.3) : 0.55 * (1 - ramp(t, 2.5, 4.8));
        const floor = down ? 0.1 : 0.9 * ramp(t, 2.5, 3.3);
        return { floor, pose: pose({ squat, arms: 'forward', reach: squat / 0.55 }), cue: down ? 'Breathe in, sit back' : 'Breathe out, lift & rise' };
      }),
    },

    heels: {
      title: 'Heel raises',
      how: 'Rise onto the balls of your feet with a gentle lift, pause, and lower slowly. Good for circulation after sitting.',
      secs: 30,
      at: reps(10, 3, (t) => {
        const heel = ramp(t, 0, 1.1) * (1 - ramp(t, 1.7, 2.9));
        return { floor: 0.8 * heel, pose: pose({ heel }), cue: t < 1.7 ? 'Rise & lift' : 'Lower slowly' };
      }),
    },

    tilts: {
      title: 'Pelvic tilts',
      how: 'Hands on your hips. Gently tuck your tailbone under, then tip it back. Small, slow movement — it wakes up the muscles around the pelvis.',
      secs: 32,
      at: reps(8, 4, (t) => {
        const tilt = -Math.sin((TAU * t) / 4);
        return { floor: Math.max(0, -tilt) * 0.65, pose: pose({ tilt, arms: 'hips' }), cue: tilt < 0 ? 'Tuck your tailbone' : 'Tip it back' };
      }),
    },

    circles: {
      title: 'Hip circles',
      how: 'Hands on your hips, knees soft. Draw slow, easy circles with your hips — loose, not forced.',
      secs: 30,
      at: (t) => {
        const dir = t < 15 ? 1 : -1;
        const a = (TAU * t) / 5;
        return {
          floor: 0.15,
          pose: pose({ swayX: Math.sin(a) * dir, swayY: Math.cos(a) * 0.8, arms: 'hips' }),
          cue: dir > 0 ? 'Circle one way' : 'Now the other way',
        };
      },
    },

    march: {
      title: 'Standing march',
      how: 'March in place, lifting each knee a little. Stay tall and keep a light, steady lift in your pelvic floor.',
      secs: 30,
      at: (t) => ({
        floor: 0.45,
        pose: pose({ march: Math.sin(Math.PI * t / 1.1) * 0.85, arms: 'hang' }),
        cue: 'Lift your knees — stay tall',
      }),
    },

    release: {
      title: 'Let it all go',
      how: 'Sitting all day can leave these muscles tense. Breathe low into your belly and let the pelvic floor drop and soften completely.',
      secs: 24,
      at: (t) => {
        const c = t % 8;
        const inhale = c < 4;
        const floor = inhale ? -0.3 * ramp(c, 0, 3.5) : -0.3 + 0.3 * ramp(c, 4, 7.5);
        return { floor, pose: pose(), cue: inhale ? 'Breathe into your belly — soften' : 'Breathe out slowly' };
      },
    },
  };

  const ROUTINES = {
    short: ['find', 'holds', 'flicks', 'squats', 'release'],
    full: ['find', 'holds', 'flicks', 'elevator', 'squats', 'heels', 'tilts', 'circles', 'march', 'release'],
  };

  const GET_READY = 4; // seconds of "Next: …" before each exercise

  function routineLength(name) {
    return (ROUTINES[name] || ROUTINES.short).reduce((a, id) => a + EXERCISES[id].secs + GET_READY, 0);
  }

  window.StandExercises = { EXERCISES, ROUTINES, GET_READY, routineLength };
})();
