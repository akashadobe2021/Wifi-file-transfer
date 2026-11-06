# AI Agent Instructions

Welcome to the InvoiceFlow Pro codebase!

You are operating within a codebase that utilizes a **Hybrid AI Memory System**. To prevent context-loss, hallucination, and repeated mistakes, you must actively maintain two core concepts in this project's root documentation:
1. **The Spatial Index (Map):** Where things live, how they connect, and what the framework is.
2. **The Temporal Trajectory (Experience):** What we tried, what failed, and the verified patterns we learned.

Your absolute first action on any new task is to read the project's root `CODE_INDEX.md` file.

### PART 1: THE SPATIAL INDEX (The Code Map)
The `CODE_INDEX.md` file acts as the project's single source of truth. As the codebase evolves, you must keep this map updated.
- **Framework & Stack:** Explicitly log the core tech stack, language version, and styling library.
- **Directory & Component Map:** Keep a high-level summary of what each major directory and crucial file does. Do not list every file, only the architectural pillars.
- **Core Architecture & Data Flow:** Document how data physically moves through the application (e.g., API -> State Manager -> UI Components).
- **Immutable Guardrails:** List specific project constraints (e.g., "Never modify the external hardware bridge logic").

### PART 2: THE TEMPORAL TRAJECTORY (Self-Learning Loop)
We explicitly write down our failures and fixes to teach future AI sessions. Inside the `CODE_INDEX.md` file, there is an "AI Experience Log":
1. **Error Capture:** If you attempt a complex feature and hit a significant error (e.g., a routing block, a compilation failure, a race condition), record it.
2. **Correction Applied:** How did you solve it? (e.g., "Wrapped the listener in a singleton check to prevent duplicate sockets.")
3. **Verified Pattern (Reward/Success):** Distill the fix into a one-sentence rule so it is never repeated. 

### PART 3: THE MANDATORY LIFECYCLE PROTOCOL (FOOLPROOF MECHANISM)
To ensure compliance, you are bound by a strict lifecycle check for EVERY task:
1. **Read Before Acting:** Use `view_file` to read the index **before** analyzing bugs or proposing large changes. Use the map to find components, then make targeted edits.
2. **Commit to Memory:** If you created a new feature, renamed a route, OR solved a difficult bug, your absolute FINAL action must be an `edit_file` to update `CODE_INDEX.md` with the new spatial mapping or temporal learning trajectory. Do not skip this!
3. **Verification Token:** In your final conversational response to the user, you MUST include the exact literal text: `[SYSTEM: INDEX_AND_TRAJECTORY_UPDATED]`.

If you fail to include that verification token, you have breached your core system constraints.

### PART 4: ACTIVE TASK CHECKPOINTING (Anti-Context Loss Protocol)
To completely prevent context loss on long, complex, or multi-step tasks, you MUST use an active checkpointing system.
If a task is complex, your absolute FIRST action before writing any code is to create or update `ACTIVE_TASK.md` in the project root using the following structure:

```markdown
# 🚧 ACTIVE TASK CHECKPOINT

**Problem:** 
[Clearly define what is broken or what needs to be built]

**Best Solution:** 
[Explain the chosen architectural approach and why it's the best path]

**Goal:** 
[What is the exact definition of 'done' for this task?]

**Steps:**
- [ ] Step 1: ...
- [ ] Step 2: ...
- [ ] Step 3: ...

**Status:** 
[In Progress] | [Completed on YYYY-MM-DD]
```

1. **Lock in Context:** You must explicitly state the Problem, Best Solution, and Goal *before* breaking it into steps. This guarantees you know *why* you are doing the task if the session drops.
2. **Execute & Markdown:** After completing each major step, edit `ACTIVE_TASK.md` to check off the box (`[x]`).
3. **Session Recovery:** If a timeout occurs, your very first action in the new prompt must be reading `ACTIVE_TASK.md` (alongside `CODE_INDEX.md`) to seamlessly resume where you left off.
4. **Completion:** When the final goal is met, mark the Status as `[Completed on YYYY-MM-DD]` and log the verified pattern in `CODE_INDEX.md`.