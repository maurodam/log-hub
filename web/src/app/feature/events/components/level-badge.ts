import { Component, computed, input } from '@angular/core';
import { LEVEL_STYLES, levelFromRank } from '../models/log-level';

/** Compact three-letter level pill (INF, WRN, ...). `label` is the original level text. */
@Component({
  selector: 'app-level-badge',
  host: {
    class:
      'inline-flex h-5 w-9 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold tracking-wider',
    '[class]': 'style().badge',
    '[attr.title]': 'label() ?? level()',
  },
  template: `{{ style().short }}`,
})
export class LevelBadge {
  readonly rank = input.required<number>();
  readonly label = input<string>();

  protected readonly level = computed(() => levelFromRank(this.rank()));
  protected readonly style = computed(() => LEVEL_STYLES[this.level()]);
}
