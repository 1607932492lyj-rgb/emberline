// The round: freeze time for buying, a live round, then a win or a loss and the
// next one. First to 5 rounds takes the match. The round ends on elimination,
// on the bomb exploding or being defused, or on the clock running out with the
// bomb unplanted (defenders win the clock).

export const FREEZE_TIME = 8;
export const ROUND_TIME = 100;
export const WIN_ROUNDS = 5;

export function createRounds() {
  const state = {
    phase: 'freeze', // freeze | live | ended
    round: 1,
    timer: FREEZE_TIME,
    emberScore: 0,
    ashScore: 0,
    winner: null,
    reason: '',
    matchWinner: null,
  };

  return {
    state,
    startRound(round) {
      state.phase = 'freeze';
      state.round = round;
      state.timer = FREEZE_TIME;
      state.winner = null;
      state.reason = '';
    },
    beginLive() {
      state.phase = 'live';
      state.timer = ROUND_TIME;
    },
    // Returns an end event { winner, reason } on the frame the round ends.
    step(dt, alive) {
      if (state.phase === 'freeze') {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.phase = 'live';
          state.timer = ROUND_TIME;
          return { event: 'live' };
        }
        return null;
      }
      if (state.phase !== 'live') return null;
      state.timer -= dt;
      if (alive.ember === 0 && alive.ash > 0) return this.end('ash', 'Ember team eliminated');
      if (alive.ash === 0 && alive.ember > 0) return this.end('ember', 'Ash team eliminated');
      if (alive.ember === 0 && alive.ash === 0) return this.end('ash', 'Both teams down');
      if (state.timer <= 0) return this.end('ash', 'Time expired, bomb not planted');
      return null;
    },
    end(winner, reason) {
      if (state.phase === 'ended') return null;
      state.phase = 'ended';
      state.winner = winner;
      state.reason = reason;
      if (winner === 'ember') state.emberScore += 1;
      else state.ashScore += 1;
      if (state.emberScore >= WIN_ROUNDS) state.matchWinner = 'ember';
      else if (state.ashScore >= WIN_ROUNDS) state.matchWinner = 'ash';
      return { event: 'ended', winner, reason };
    },
    reset() {
      state.phase = 'freeze';
      state.round = 1;
      state.timer = FREEZE_TIME;
      state.emberScore = 0;
      state.ashScore = 0;
      state.winner = null;
      state.reason = '';
      state.matchWinner = null;
    },
  };
}
