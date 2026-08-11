'use strict';

class PaletteDebt {
  static PALETTE = { danger: '#bada55' };

  render(parent) {
    const row = parent.createEl('div');
    row.style.color = PaletteDebt.PALETTE.danger;
    return row;
  }
}

module.exports = { PaletteDebt };
