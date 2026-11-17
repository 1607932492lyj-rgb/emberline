// The economy: money earned each round, spent in the buy menu during freeze time.
// Win $3250, loss $1900, $500 more after two straight losses; a kill pays $300.
// The buy menu is a fixed list: one price per item, no haggling.
import { WEAPON_DEFS, GRENADE_DEFS } from './weapons.js';

export const ARMOR_PRICE = 650;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const KILL_REWARD = 300;

export const BUY_ITEMS = [
  { id: 'rifle', kind: 'weapon', name: WEAPON_DEFS.rifle.name, price: WEAPON_DEFS.rifle.price },
  { id: 'smg', kind: 'weapon', name: WEAPON_DEFS.smg.name, price: WEAPON_DEFS.smg.price },
  { id: 'dmr', kind: 'weapon', name: WEAPON_DEFS.dmr.name, price: WEAPON_DEFS.dmr.price },
  { id: 'shotgun', kind: 'weapon', name: WEAPON_DEFS.shotgun.name, price: WEAPON_DEFS.shotgun.price },
  { id: 'frag', kind: 'grenade', name: GRENADE_DEFS.frag.name, price: GRENADE_DEFS.frag.price },
  { id: 'flash', kind: 'grenade', name: GRENADE_DEFS.flash.name, price: GRENADE_DEFS.flash.price },
  { id: 'armor', kind: 'armor', name: 'Kevlar vest', price: ARMOR_PRICE },
];

export function createEconomy() {
  const state = { money: 800, losses: 0, kills: 0 };

  return {
    state,
    canAfford(price) {
      return state.money >= price;
    },
    // Returns true when the purchase went through.
    buy(item, weapons, armor) {
      if (state.money < item.price) return false;
      if (item.kind === 'weapon' && weapons.state.owned.has(item.id)) return false;
      if (item.kind === 'grenade' && weapons.state.grenades[item.id] >= GRENADE_DEFS[item.id].max) return false;
      if (item.kind === 'armor' && armor.value >= 100) return false;
      state.money -= item.price;
      if (item.kind === 'weapon') weapons.own(item.id);
      else if (item.kind === 'grenade') weapons.state.grenades[item.id] += 1;
      else armor.value = 100;
      return true;
    },
    roundReward(won) {
      if (won) {
        state.money += WIN_REWARD;
        state.losses = 0;
      } else {
        state.money += LOSS_REWARD + (state.losses >= 1 ? LOSS_STREAK_BONUS : 0);
        state.losses += 1;
      }
    },
    killReward() {
      state.money += KILL_REWARD;
      state.kills += 1;
    },
    reset() {
      state.money = 800;
      state.losses = 0;
      state.kills = 0;
    },
  };
}
