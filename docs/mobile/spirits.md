# Spirits (Linh thú)

Dev-facing design for the collectible spirits that replace Blips. Art: [mockups/spirits.html](../../mockups/spirits.html). Landing roster: [landing/src/content/spirits.ts](../../landing/src/content/spirits.ts). Parts library: #259.

## Rules

- Scheduling, DLU sync and reminders stay free for everyone. Spirits add convenience and status only.
- Spirits hatch from finished tasks and streaks, never from payment.
- Abilities act through existing features (scheduler, ingestion, reminders). None bypass placement invariants.

## Roster, season one

| No | Spirit | Element | Rarity | Weight |
|---|---|---|---|---|
| 001 | Cửu vĩ hồ, flame fox | Hỏa | Rare | 2 |
| 002 | Phong lang, storm wolf | Phong | Epic | 3 |
| 003 | Thủy xà, tide serpent | Thủy | Rare | 2 |
| 004 | Mộc lộc, thorn stag | Mộc | Common | 1 |
| 005 | Băng cú, frost owl | Băng | Common | 1 |
| 006 | Lôi miêu, volt lynx | Lôi | Rare | 2 |
| 007 | Ảnh báo, umbra panther | Ảnh | Epic | 3 |
| 008 | Nhật phượng, sunrise phoenix | Nhật | Legendary | 5 |

Rarity weights: common 1, rare 2, epic 3, legendary 5. Each spirit has three stages: egg, hatchling, ascended.

## Power

Power is the sum of rarity weights over spirits the student owns. Season one maxes at 19.

| Power | Account perk |
|---|---|
| 3 | One streak shield a week |
| 6 | Daily brief: the spirit pushes tomorrow's plan at a chosen time |
| 10 | Chat with the spirit in Zalo or Messenger to add, move or finish tasks |
| 14 | Connect AI tools over MCP with a higher daily limit |
| 19 | Season title, profile badge, early access to the next season |

- Chat quota: 10 messages a day per power point. It caps AI cost per student.
- Perks unlock on reaching the threshold and stay for the season.

## Equipped abilities

One equip slot at the start, a second at 6 spirits owned. Each spirit gives one ability while equipped.

| Spirit | Ability | Effect | Built on |
|---|---|---|---|
| Cửu vĩ hồ | Rescue | One tap rebuilds the plan for an overdue task before its deadline | Scheduler replan |
| Phong lang | Exam pack | Spreads revision sessions before each exam in the DLU schedule | Ingestion, session series |
| Thủy xà | Reflow | Reflows the rest of the week when a class moves or a block is skipped | Scheduler replan |
| Mộc lộc | Roots | Protects slots for recurring habits | Session series |
| Băng cú | Focus guard | Mutes notifications during study blocks | Reminders, device push |
| Lôi miêu | Quick capture | Turns a forwarded LMS link or message into a task | Ingestion |
| Ảnh báo | Night review | Evening recap of today and preview of tomorrow | Daily push |
| Nhật phượng | Rebirth | Restores a broken streak once a month | Streaks |

## Chat and MCP

- Students meet chat through Zalo or Messenger, with the equipped spirit as the voice. No MCP setup needed.
- MCP is the route for students who connect Claude or ChatGPT. It exposes the same task and schedule actions as chat.
- Both share the power-based daily quota.

## Art

- Side view, facing right, flat fills, curves only, no outlines.
- Every shape has a role class (`b` body, `s` far side, `h` highlight, `a` accent, `e` eye, `t` teeth) and reads its colour from a variable, so one drawing renders in colour or locked.
- The logo curve sits on each flank as the flow mark.
- Locked spirits: warm ink body, umber far side and flow mark, cream eyes.
- Motion is CSS on named parts (`sway`, `flap`, `flick`) and stops under Reduce Motion.
