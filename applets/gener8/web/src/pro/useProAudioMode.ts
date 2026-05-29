import { useCallback, useReducer } from 'react';

export type ProAudioMode = 'song' | 'reference' | 'cover';

export interface ProAudioState {
  mode: ProAudioMode;
  referenceAudioUrl: string;
  referenceAudioLabel: string;
  referenceDuration: number;
  sourceAudioUrl: string;
  sourceAudioLabel: string;
  sourceDuration: number;
  audioCoverStrength: number;
}

export type ProAudioAction =
  | { type: 'setMode'; mode: ProAudioMode }
  | { type: 'setReference'; url: string; label?: string; duration?: number }
  | { type: 'setSource'; url: string; label?: string; duration?: number }
  | { type: 'clearReference' }
  | { type: 'clearSource' }
  | { type: 'setCoverStrength'; value: number };

export const initialProAudioState: ProAudioState = {
  mode: 'reference',
  referenceAudioUrl: '',
  referenceAudioLabel: '',
  referenceDuration: 0,
  sourceAudioUrl: '',
  sourceAudioLabel: '',
  sourceDuration: 0,
  audioCoverStrength: 1.0,
};

export function proAudioReducer(
  state: ProAudioState,
  action: ProAudioAction,
): ProAudioState {
  switch (action.type) {
    case 'setMode':
      if (action.mode === 'song') {
        return {
          ...state,
          mode: 'song',
          referenceAudioUrl: '',
          referenceAudioLabel: '',
          referenceDuration: 0,
          sourceAudioUrl: '',
          sourceAudioLabel: '',
          sourceDuration: 0,
        };
      }
      if (action.mode === 'reference') {
        return {
          ...state,
          mode: 'reference',
          sourceAudioUrl: '',
          sourceAudioLabel: '',
          sourceDuration: 0,
        };
      }
      return {
        ...state,
        mode: 'cover',
        referenceAudioUrl: '',
        referenceAudioLabel: '',
        referenceDuration: 0,
      };
    case 'setReference':
      return {
        ...state,
        mode: 'reference',
        referenceAudioUrl: action.url,
        referenceAudioLabel: action.label || '',
        referenceDuration: action.duration ?? state.referenceDuration,
        sourceAudioUrl: '',
        sourceAudioLabel: '',
        sourceDuration: 0,
      };
    case 'setSource':
      return {
        ...state,
        mode: 'cover',
        sourceAudioUrl: action.url,
        sourceAudioLabel: action.label || '',
        sourceDuration: action.duration ?? state.sourceDuration,
        referenceAudioUrl: '',
        referenceAudioLabel: '',
        referenceDuration: 0,
      };
    case 'clearReference':
      return {
        ...state,
        referenceAudioUrl: '',
        referenceAudioLabel: '',
        referenceDuration: 0,
      };
    case 'clearSource':
      return {
        ...state,
        sourceAudioUrl: '',
        sourceAudioLabel: '',
        sourceDuration: 0,
      };
    case 'setCoverStrength':
      return {
        ...state,
        audioCoverStrength: Math.max(0, Math.min(1, action.value)),
      };
    default:
      return state;
  }
}

export function useProAudioMode(initialState: ProAudioState = initialProAudioState) {
  const [state, dispatch] = useReducer(proAudioReducer, initialState);
  const setMode = useCallback((mode: ProAudioMode) => dispatch({ type: 'setMode', mode }), []);
  return { state, dispatch, setMode };
}
