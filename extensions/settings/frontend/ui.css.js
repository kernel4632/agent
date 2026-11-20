/*
设置控件的样式：只用 web 的 Grok 变量（--bg / --soft / --line / --text / --accent …），浅色深色自动跟随。
分组卡片是 20px 圆角的浅底块，行最少 64px 高；图标块 40px，按钮和开关都 ≥36px，再用 .hit 补到 ≥40px。
pane 容器窄于 560px（手机）时，输入框和分段选择换到标题下面并占满整行；开关和箭头留在右边。
*/
export const css = `
.ui-list { display: grid; gap: 8px; }
.ui-list + .ui-list { margin-top: 24px; }
.ui-list__title { margin: 0; padding: 0 6px; font-size: 13px; font-weight: 500; color: var(--faint); }
.ui-list__card { overflow: hidden; border-radius: 20px; background: var(--soft); }
.ui-list__note { margin: 2px 6px 0; font-size: 12.5px; line-height: 18px; color: var(--faint); }
.ui-row {
  display: flex; align-items: center; gap: 14px; width: 100%; min-height: 64px; padding: 12px 18px;
  border: 0; background: transparent; color: var(--text); font: inherit; text-align: left;
}
.ui-row + .ui-row { box-shadow: inset 0 1px 0 var(--line-soft); }
.ui-row--link { cursor: pointer; }
.ui-row--link:hover, .ui-card:hover { background: var(--hover); }
.ui-row.is-on { background: var(--soft-strong); }
.ui-row--wide { flex-wrap: wrap; }
.ui-row--wide .ui-row__control { width: 100%; justify-content: flex-start; }
.ui-row__copy { display: grid; gap: 2px; flex: 1; min-width: 0; }
.ui-row__title { font-size: 15px; font-weight: 500; line-height: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-row__desc { font-size: 13px; line-height: 19px; color: var(--muted); }
.ui-row--link .ui-row__desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-row__control { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: none; max-width: 100%; }
.ui-tile { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 12px; background: var(--soft-strong); color: var(--text); }
.ui-tile--accent { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.ui-tile--success { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
.ui-tile--warn { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
.ui-chevron { display: grid; flex: none; color: var(--faint); }
.ui-card {
  display: flex; align-items: center; gap: 14px; min-height: 84px; padding: 14px 16px 14px 18px;
  border-radius: 20px; background: var(--soft); color: var(--text); cursor: pointer;
}
.ui-card + .ui-card { margin-top: 8px; }
.ui-card.is-off .ui-tile { background: var(--soft-strong); color: var(--faint); }
.ui-card__copy { display: grid; gap: 3px; flex: 1; min-width: 0; }
.ui-card__copy strong { font-size: 15px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-card__copy small { font-size: 12.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.ui-tags > span { padding: 1px 8px; border-radius: 999px; background: var(--soft-strong); color: var(--muted); font-size: 11.5px; line-height: 18px; }
.ui-switch { position: relative; display: inline-grid; flex: none; width: 44px; height: 26px; cursor: pointer; }
.ui-switch input { position: absolute; inset: -8px; width: auto; height: auto; margin: 0; opacity: 0; cursor: inherit; z-index: 1; }
.ui-switch__track { display: flex; align-items: center; padding: 3px; border-radius: 999px; background: var(--soft-hover); transition: background-color .15s; }
.ui-switch__thumb { width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .2); transition: transform .18s; }
.ui-switch input:checked + .ui-switch__track { background: var(--accent); }
.ui-switch input:checked + .ui-switch__track .ui-switch__thumb { transform: translateX(18px); }
.ui-switch input:focus-visible + .ui-switch__track { outline: 2px solid var(--accent); outline-offset: 2px; }
.ui-switch.is-disabled { opacity: .45; cursor: not-allowed; }
.ui-field {
  width: min(300px, 100%); height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px;
  background: var(--surface); color: var(--text); font: inherit; font-size: 14px; outline: 0;
}
.ui-field:focus { border-color: var(--line-strong); }
.ui-field::placeholder { color: var(--faint); }
.ui-select { padding-right: 10px; cursor: pointer; }
.ui-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--soft-strong); }
.ui-seg button { height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; }
.ui-seg button.is-on { background: var(--surface); color: var(--text); font-weight: 550; box-shadow: 0 1px 2px rgba(0, 0, 0, .1); }
.ui-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; padding: 0 16px; border: 0; border-radius: 999px;
  background: var(--soft-strong); color: var(--text); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap;
}
.ui-btn:hover { background: var(--soft-hover); }
.ui-btn--primary { background: var(--primary); color: var(--on-primary); }
.ui-btn--primary:hover { background: var(--primary); opacity: .88; }
.ui-btn--danger { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
.ui-btn--danger:hover { background: color-mix(in srgb, var(--danger) 16%, transparent); }
.ui-round { display: grid; place-items: center; flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--muted); cursor: pointer; }
.ui-round:hover { background: var(--soft-hover); color: var(--text); }
.ui-empty { display: grid; justify-items: center; gap: 10px; padding: 48px 20px; color: var(--faint); text-align: center; }
.ui-empty strong { color: var(--text); font-size: 16px; font-weight: 500; }
.ui-empty p { margin: 0; font-size: 13px; }
.ui-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.ui-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 44px; padding: 0 16px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--faint); }
.ui-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 14px; }
.ui-hint { margin: 0 0 16px; padding: 0 6px; font-size: 13px; line-height: 20px; color: var(--muted); }
@container pane (max-width: 560px) {
  .ui-row:has(.ui-field, .ui-seg) { flex-wrap: wrap; }
  .ui-row:has(.ui-field, .ui-seg) .ui-row__control { width: 100%; justify-content: flex-start; }
  .ui-row .ui-field { width: 100%; }
  .ui-row { padding: 12px 16px; }
}
`
