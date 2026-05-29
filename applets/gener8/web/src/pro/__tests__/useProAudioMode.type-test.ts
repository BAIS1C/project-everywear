import { initialProAudioState, proAudioReducer } from '../useProAudioMode';

const withReference = proAudioReducer(initialProAudioState, {
  type: 'setReference',
  url: '/audio/reference.wav',
  label: 'Reference',
  duration: 42,
});

if (withReference.sourceAudioUrl) {
  throw new Error('Reference mode must clear stale cover source audio.');
}

const withCover = proAudioReducer(withReference, {
  type: 'setSource',
  url: '/audio/source.wav',
  label: 'Source',
  duration: 180,
});

if (withCover.referenceAudioUrl) {
  throw new Error('Cover mode must clear stale reference audio.');
}

const backToSong = proAudioReducer(withCover, { type: 'setMode', mode: 'song' });

if (backToSong.referenceAudioUrl || backToSong.sourceAudioUrl) {
  throw new Error('Returning to Song must clear both audio slots.');
}
