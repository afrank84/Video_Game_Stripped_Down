# Server Stack

A physics-based competitive tower builder where players construct unstable server towers for profit.

Inspired by:

* Tricky Towers
* incremental risk systems
* chaotic multiplayer physics games
* DevOps/server room humor

---

# Core Concept

Players stack falling server-shaped tetromino blocks onto a small platform.

Every block has:

* a physics shape
* a monetary value
* risk/reward behavior

The objective is simple:

```text
Build the most profitable server tower before everything collapses.
```

---

# Core Gameplay Loop

1. A random server piece appears
2. Player moves and rotates the piece
3. Piece locks immediately once touching the tower
4. Tower grows taller and less stable
5. Active server blocks generate or lose money over time
6. Pieces that fall off the tower become liabilities
7. Player attempts to maximize profit while preventing collapse

---

# Controls

```text id="m6z7as"
LEFT ARROW  = Move Left
RIGHT ARROW = Move Right
SPACE       = Rotate Clockwise
ESC         = Pause
```

---

# Platform Rules

The tower must remain connected to the central platform.

Any piece touching the ground outside the platform:

* is removed
* no longer contributes value
* may become a financial penalty

This creates:

* tension
* recovery moments
* greedy overextensions
* dramatic collapses

---

# Server Types

## Green Server

```text
Generates money while attached to the tower.
```

Behavior:

* profitable
* useful
* encourages expansion

Risk:

* falling pieces stop generating income

---

## Red Server

```text
Loses money when disconnected from the tower.
```

Behavior:

* dangerous
* destabilizing
* punishes poor placement

Risk:

* tower collapses become expensive

---

## Yellow Stabilizer

```text
Locks permanently into place once attached.
```

Behavior:

* extremely stable
* acts as structural support
* cannot fall after placement

Tradeoff:

* generates no income

Purpose:

* allows players to sacrifice profit for stability

---

# Design Pillars

## 1. Physical Instability

The tower should:

* wobble
* lean
* shake
* barely survive

A perfect tower is boring.

The fun comes from:

```text
controlled disaster
```

---

## 2. Greed Creates Risk

High-profit towers are naturally unstable.

Players constantly decide:

```text
Do I build safely...
or get rich?
```

---

## 3. Simple Rules, Emergent Chaos

The game intentionally avoids:

* complex resource trees
* crafting systems
* simulation overload
* realistic networking mechanics

Instead:

* physics
* stacking
* money pressure
* unstable structures

create emergent gameplay naturally.

---

# Intended Feel

The ideal emotional experience is:

```text
"I can probably place one more piece..."
```

followed immediately by:

```text
OH NO OH NO OH NO
```

---

# Multiplayer Potential

Possible future modes:

* local multiplayer
* online versus
* shared tower mode
* sabotage cards
* income races
* survival rounds

---

# Future Ideas

## Cards / Modifiers

Examples:

* Overclocked Servers
* Cheap Cooling
* AI Automation
* Intern Deployment
* Quantum Servers

These would alter:

* stability
* money generation
* gravity
* physics behavior

---

## Special Blocks

Examples:

* explosive servers
* sticky servers
* bouncing servers
* giant servers
* ultra-light servers

---

## Win Conditions

Possible formats:

* highest money after timer
* first to profit goal
* last surviving tower
* tallest stable tower

---

# Technical Direction

Current prototype:

* single HTML file
* Matter.js physics
* browser-based
* lightweight prototype-first architecture
