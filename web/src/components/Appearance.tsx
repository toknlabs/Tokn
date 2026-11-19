"use client";

import { useState } from "react";
import {
  ACCENTS,
  AVATAR_STYLES,
  BLOCKS,
  BLOCK_LABELS,
  LOOKS,
  lookOf,
  OFFERED_BLOCKS,
  STATS,
  STAT_LABELS,
  STAT_SLOTS,
  type Accent,
  type AvatarStyle,
  type BlockKey,
  type ProfilePrefs,
  type StatKey,
} from "@/lib/prefs";
import { Avatar } from "./Avatar";
import { LookGlyph } from "./LookGlyph";
import { SettingsGroup } from "./SettingsGroup";

/**
 * The appearance controls on the settings page.
 *
 * Client-side so choices preview immediately — the swatches recolour the
 * surrounding preview, and reordering a block moves it without a round trip.
 * Every control writes a plain hidden input, so the surrounding server action
 * reads them from FormData with no extra wiring.
 *
 * It renders two groups rather than one. The accent and avatar are how the
 * profile looks; the headline figures and sections are which numbers it
 * reports, which is a different question and belongs under stats.
 */

export function Appearance({
  handle,
  initial,
  avatarUrl,
}: {
  handle: string;
  initial: ProfilePrefs;
  avatarUrl: string | null;
}) {
  const [accent, setAccent] = useState<Accent>(initial.accent);
  const [avatar, setAvatar] = useState<AvatarStyle>(initial.avatar);
  const [blocks, setBlocks] = useState<BlockKey[]>(initial.blocks);
  const [stats, setStats] = useState<StatKey[]>(initial.stats);
  const [looks, setLooks] = useState(initial.looks);
  const [half, setHalf] = useState<BlockKey[]>(initial.half);

  // Hidden blocks live after the visible ones, so the list is one ordering.
  // Removed sections are not offered at all.
  const blockOrder: BlockKey[] = [
    ...blocks,
    ...OFFERED_BLOCKS.filter((key) => !blocks.includes(key)),
  ];

  function moveBlock(key: BlockKey, delta: number) {
    const index = blocks.indexOf(key);
    if (index < 0) return;
    const next = [...blocks];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setBlocks(next);
  }

  function toggleBlock(key: BlockKey) {
    setBlocks((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key],
    );
  }

  function toggleStat(key: StatKey) {
    setStats((current) => {
      if (current.includes(key))
        return current.filter((entry) => entry !== key);
      // Fixed number of slots: choosing a fifth drops the oldest choice rather
      // than refusing the click.
      return [...current, key].slice(-STAT_SLOTS);
    });
  }

  return (
    <div data-accent={accent} style={{ display: "contents" }}>
      <input type="hidden" name="accent" value={accent} />
      <input type="hidden" name="avatar" value={avatar} />
      {blocks.map((key) => (
        <input key={key} type="hidden" name="block" value={key} />
      ))}
      {stats.map((key) => (
        <input key={key} type="hidden" name="stat" value={key} />
      ))}
      {BLOCKS.map((key) => (
        <input
          key={key}
          type="hidden"
          name={`look.${key}`}
          value={lookOf({ ...initial, looks }, key)}
        />
      ))}
      {half.map((key) => (
        <input key={key} type="hidden" name="half" value={key} />
      ))}

      <SettingsGroup
        title="appearance"
        note="how your profile looks to everyone else"
      >
        <div className="setting">
          <div className="setting-label">
            accent
            <small>
              the colour on your profile, for everyone who visits it
            </small>
          </div>
          <div>
            <div className="swatches">
              {ACCENTS.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="swatch"
                  data-accent={name}
                  data-selected={name === accent}
                  onClick={() => setAccent(name)}
                  title={name}
                  aria-label={name}
                  aria-pressed={name === accent}
                />
              ))}
            </div>
            <p className="micro" style={{ marginTop: "0.6rem" }}>
              {accent} · each accent has a light and a dark value, so it stays
              readable either way
            </p>
          </div>
        </div>

        <div className="setting">
          <div className="setting-label">
            avatar
            <small>nothing to upload</small>
          </div>
          <div className="row" style={{ gap: "1.25rem" }}>
            {AVATAR_STYLES.map((style) => {
              const disabled = style === "github" && !avatarUrl;
              return (
                <button
                  key={style}
                  type="button"
                  className="btn bare"
                  onClick={() => !disabled && setAvatar(style)}
                  disabled={disabled}
                  aria-pressed={style === avatar}
                  style={{
                    flexDirection: "column",
                    gap: "0.45rem",
                    opacity: disabled ? 0.35 : 1,
                    color: style === avatar ? "var(--text)" : "var(--sub)",
                  }}
                  title={disabled ? "link a github account first" : style}
                >
                  <span
                    style={{
                      outline:
                        style === avatar
                          ? "2px solid var(--main)"
                          : "2px solid transparent",
                      outlineOffset: 3,
                      borderRadius: "50%",
                      display: "inline-flex",
                    }}
                  >
                    <Avatar
                      handle={handle}
                      size={36}
                      style={style}
                      url={avatarUrl}
                    />
                  </span>
                  <span style={{ fontSize: "0.6875rem" }}>{style}</span>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="stats"
        note="which numbers your profile reports, and in what order"
      >
        <div className="setting">
          <div className="setting-label">
            headline figures
            <small>
              pick {STAT_SLOTS} · {stats.length}/{STAT_SLOTS} chosen
            </small>
          </div>
          <div className="picker">
            {STATS.map((key) => (
              <label
                className="picker-row"
                key={key}
                data-on={stats.includes(key)}
              >
                <input
                  type="checkbox"
                  className="check"
                  checked={stats.includes(key)}
                  onChange={() => toggleStat(key)}
                />
                <span className="name">{STAT_LABELS[key]}</span>
                {stats.includes(key) && (
                  <span className="micro">{stats.indexOf(key) + 1}</span>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="setting">
          <div className="setting-label">
            sections
            <small>
              what shows on your profile, in what order, how each one looks,
              and whether it takes the full width or sits beside another
            </small>
          </div>
          <div className="picker">
            {blockOrder.map((key) => {
              const on = blocks.includes(key);
              const position = blocks.indexOf(key);
              const options = LOOKS[key] as readonly {
                key: string;
                label: string;
                glyph: Parameters<typeof LookGlyph>[0]["glyph"];
              }[];
              const current = lookOf({ ...initial, looks }, key);
              const isHalf = half.includes(key);
              return (
                <div className="picker-row section-row" key={key} data-on={on}>
                  <div className="section-head">
                    <input
                      type="checkbox"
                      className="check"
                      checked={on}
                      onChange={() => toggleBlock(key)}
                      aria-label={BLOCK_LABELS[key]}
                    />
                    <span className="name">{BLOCK_LABELS[key]}</span>
                    <button
                      type="button"
                      className="ord"
                      onClick={() => moveBlock(key, -1)}
                      disabled={!on || position <= 0}
                      aria-label={`move ${BLOCK_LABELS[key]} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ord"
                      onClick={() => moveBlock(key, 1)}
                      disabled={
                        !on || position < 0 || position >= blocks.length - 1
                      }
                      aria-label={`move ${BLOCK_LABELS[key]} down`}
                    >
                      ↓
                    </button>
                  </div>

                  {/* Only for a section that is showing: choosing how a
                      hidden section looks is a decision with nothing to see. */}
                  {on && (
                    <div className="section-opts">
                      {options.length > 1 && (
                        <div
                          className="looks"
                          role="group"
                          aria-label={`${BLOCK_LABELS[key]} look`}
                        >
                          {options.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              className="look"
                              data-on={option.key === current ? "" : undefined}
                              aria-pressed={option.key === current}
                              onClick={() =>
                                setLooks((prev) => ({ ...prev, [key]: option.key }))
                              }
                            >
                              <LookGlyph glyph={option.glyph} />
                              <span>{option.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div
                        className="widths"
                        role="group"
                        aria-label={`${BLOCK_LABELS[key]} width`}
                      >
                        {(["full", "half"] as const).map((width) => {
                          const chosen = (width === "half") === isHalf;
                          return (
                            <button
                              key={width}
                              type="button"
                              className="look width"
                              data-on={chosen ? "" : undefined}
                              aria-pressed={chosen}
                              onClick={() =>
                                setHalf((prev) =>
                                  width === "half"
                                    ? [...prev.filter((k) => k !== key), key]
                                    : prev.filter((k) => k !== key),
                                )
                              }
                            >
                              <svg
                                viewBox="0 0 28 18"
                                width={28}
                                height={18}
                                aria-hidden="true"
                                className="look-glyph"
                              >
                                <rect x={1} y={3} width={width === "full" ? 26 : 12} height={12} rx={2} fill="currentColor" />
                                {width === "half" && (
                                  <rect x={15} y={3} width={12} height={12} rx={2} fill="currentColor" opacity={0.3} />
                                )}
                              </svg>
                              <span>{width}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}
