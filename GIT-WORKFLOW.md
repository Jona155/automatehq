# Git Workflow Guide

## 📋 Table of Contents
- [What Went Wrong](#what-went-wrong)
- [Core Workflow: Feature Branch Development](#core-workflow-feature-branch-development)
- [Daily Development Commands](#daily-development-commands)
- [Checklists](#checklists)
- [Common Issues & Solutions](#common-issues--solutions)
- [Quick Reference](#quick-reference)

---

## What Went Wrong

### The Problem You Experienced
When you merged `sites-inner-page` into main and then came back to main, you saw an earlier version. Here's what actually happened:

1. ❌ **You had untracked files** (mock HTML files) that weren't committed
2. ❌ **You committed with a poor message** ("m") making it hard to track changes
3. ❌ **You pushed directly to main** without properly merging your feature branch
4. ❌ **Your local main was out of sync** with remote main
5. ❌ **The feature branch had changes that weren't in main**

### The Root Causes
```
Remote main:    [old] ← You saw this when pulling
Local main:     [old] ← Out of sync
Feature branch: [old] → [new changes] ← Your work was here
```

**Result**: When you switched to main and pulled, you got the old version because your changes were only on the feature branch and not properly merged into main.

---

## Core Workflow: Feature Branch Development

### 🎯 The Golden Rule
**ALWAYS** develop features on a separate branch, NEVER directly on main.

### Step-by-Step Process

#### 1️⃣ Before Starting ANY Feature

```powershell
# 1. Make sure you're on main
git checkout main

# 2. Pull the absolute latest from remote
git pull origin main

# 3. Verify you're up to date
git status
# Should say: "Your branch is up to date with 'origin/main'"
```

**Why**: Ensures you start with the latest code and avoid conflicts later.

---

#### 2️⃣ Create Your Feature Branch

```powershell
# Create and switch to new branch (use descriptive names!)
git checkout -b feature-name

# Examples of good branch names:
# - add-payment-integration
# - fix-login-bug
# - refactor-database-layer
# - update-api-endpoints
```

**Naming Convention**:
- Use lowercase and hyphens
- Be descriptive but concise
- Include the type: `feature-`, `fix-`, `refactor-`, `update-`

---

#### 3️⃣ Develop Your Feature

```powershell
# Make your code changes...

# Check what files you've modified
git status

# See the actual changes
git diff

# Add specific files (PREFERRED - be intentional!)
git add path/to/file1.py path/to/file2.js

# OR add all changes (use with caution!)
git add .

# Commit with a meaningful message
git commit -m "Add user authentication endpoints"
```

**Commit Message Best Practices**:
- Use present tense: "Add feature" not "Added feature"
- Be specific: "Fix login validation bug" not "fix bug"
- Explain what, not how: "Implement user search" not "Add search function"
- Keep first line under 50 characters
- Add details on separate lines if needed:

```powershell
git commit -m "Add user authentication endpoints" `
           -m "- Implement JWT token generation" `
           -m "- Add login and logout endpoints" `
           -m "- Add password hashing with bcrypt"
```

---

#### 4️⃣ Push Your Feature Branch

```powershell
# First time pushing this branch
git push -u origin feature-name

# Subsequent pushes
git push
```

**Why push frequently?**
- Backs up your work
- Allows team collaboration
- Enables code review
- Prevents data loss

---

#### 5️⃣ Keep Your Branch Updated (Important!)

While working on your feature, main might get updates from other developers:

```powershell
# 1. Commit your current work first!
git add .
git commit -m "WIP: describe current state"

# 2. Get latest from main
git checkout main
git pull origin main

# 3. Go back to your feature branch
git checkout feature-name

# 4. Merge main into your feature branch
git merge main

# 5. Resolve any conflicts if they appear
# (Edit files, remove conflict markers, then:)
git add .
git commit -m "Merge latest main into feature branch"

# 6. Push updated branch
git push
```

**When to do this?**
- Before merging back to main (required)
- After main gets significant updates
- At least once a day on long-running features

---

#### 6️⃣ Ready to Merge? Pre-Merge Checklist

Before merging your feature into main, verify:

```powershell
# ✅ 1. All changes are committed
git status
# Should show: "nothing to commit, working tree clean"

# ✅ 2. Your branch is pushed
git push

# ✅ 3. You have latest main merged in
git checkout main
git pull origin main
git checkout feature-name
git merge main

# ✅ 4. Everything works (run tests if you have them)
# Test your application manually or run:
# npm test
# pytest
# python -m pytest
```

---

#### 7️⃣ Merge Feature into Main

```powershell
# 1. Switch to main
git checkout main

# 2. Pull latest (one more time to be safe!)
git pull origin main

# 3. Merge your feature branch
git merge feature-name --no-ff -m "Merge feature-name: Brief description of feature"

# The --no-ff flag creates a merge commit, preserving branch history

# 4. Push to remote immediately
git push origin main

# 5. Verify everything is updated
git status
# Should say: "Your branch is up to date with 'origin/main'"
```

---

#### 8️⃣ Clean Up (Optional)

After successful merge, you can delete the feature branch:

```powershell
# Delete local branch
git branch -d feature-name

# Delete remote branch
git push origin --delete feature-name
```

**Note**: Only delete if you're 100% done with the feature!

---

## Daily Development Commands

### Starting Your Day

```powershell
# 1. See what branch you're on
git branch

# 2. Update main
git checkout main
git pull origin main

# 3. Continue on your feature branch
git checkout feature-name

# 4. Get latest changes if others are working on same branch
git pull
```

### During Development

```powershell
# Check what you've changed
git status
git diff

# Commit frequently (small, logical chunks)
git add specific/files
git commit -m "Descriptive message"

# Push regularly
git push
```

### End of Day

```powershell
# Make sure all work is committed
git status

# Push everything
git push

# Switch to main so you start fresh tomorrow
git checkout main
```

---

## Checklists

### ✅ Before Starting a New Feature

- [ ] I am on the main branch (`git branch` shows `* main`)
- [ ] I have the latest main (`git pull origin main`)
- [ ] My working directory is clean (`git status` shows clean)
- [ ] I created a new feature branch with a good name
- [ ] I verified I'm on the new branch (`git branch` shows `* feature-name`)

### ✅ Before Committing

- [ ] I reviewed what files changed (`git status`)
- [ ] I reviewed the actual changes (`git diff`)
- [ ] I'm only committing files related to this feature
- [ ] I have a clear, descriptive commit message ready
- [ ] I'm not committing sensitive files (.env, credentials, etc.)
- [ ] I'm not committing generated files (node_modules, __pycache__, etc.)

### ✅ Before Merging to Main

- [ ] All my changes are committed (`git status` is clean)
- [ ] My feature branch is pushed to remote
- [ ] I merged latest main into my feature branch
- [ ] I tested everything works
- [ ] My commit messages are clear and descriptive
- [ ] I'm ready to push to production (main should always be deployable)

### ✅ After Merging to Main

- [ ] I merged feature branch into main
- [ ] I pushed main to remote immediately
- [ ] I verified main is up to date with remote
- [ ] I tested the application on main branch
- [ ] I considered deleting the feature branch if done

---

## Common Issues & Solutions

### Issue 1: "I see old code when I switch to main"

**Cause**: Your changes are on a feature branch but not merged into main.

**Solution**:
```powershell
# 1. Go to main
git checkout main

# 2. Pull latest
git pull origin main

# 3. Merge your feature branch
git merge feature-name

# 4. Push immediately
git push origin main
```

---

### Issue 2: "I have uncommitted changes and need to switch branches"

**Option A: Commit them** (preferred if work is done)
```powershell
git add .
git commit -m "Descriptive message"
git checkout other-branch
```

**Option B: Stash them** (if work is incomplete)
```powershell
# Save changes temporarily
git stash save "WIP: description"

# Switch branches
git checkout other-branch

# Later, get changes back
git checkout original-branch
git stash pop
```

---

### Issue 3: "My branch is behind/ahead of remote"

**Behind remote** (someone else pushed):
```powershell
git pull
```

**Ahead of remote** (you haven't pushed):
```powershell
git push
```

**Diverged** (both happened):
```powershell
# Pull with rebase to avoid merge commit
git pull --rebase

# Or pull normally and merge
git pull
```

---

### Issue 4: "I committed to the wrong branch"

**If you haven't pushed yet**:
```powershell
# 1. Note the commit hash
git log --oneline -1

# 2. Undo the commit but keep changes
git reset HEAD~1

# 3. Switch to correct branch
git checkout correct-branch

# 4. Commit again
git add .
git commit -m "Your message"
```

---

### Issue 5: "I want to undo my last commit"

**Keep the changes** (most common):
```powershell
git reset HEAD~1
# Your files are unchanged, commit is undone
```

**Discard the changes** (careful!):
```powershell
git reset --hard HEAD~1
# ⚠️ This deletes your changes permanently!
```

---

### Issue 6: "I have merge conflicts"

```powershell
# 1. Git will tell you which files have conflicts
git status

# 2. Open each conflicted file and look for:
<<<<<<< HEAD
Your changes
=======
Their changes
>>>>>>> branch-name

# 3. Edit the file to keep what you want, remove markers

# 4. Mark as resolved
git add conflicted-file.py

# 5. Complete the merge
git commit -m "Resolve merge conflicts"
```

---

### Issue 7: "I need to update my branch with latest main"

```powershell
# Method 1: Merge (creates merge commit)
git checkout main
git pull origin main
git checkout feature-branch
git merge main

# Method 2: Rebase (cleaner history, more advanced)
git checkout feature-branch
git rebase main
```

---

### Issue 8: "I accidentally deleted a file"

**If not committed yet**:
```powershell
git restore filename
```

**If committed and pushed**:
```powershell
git log -- filename  # Find commit where it existed
git checkout <commit-hash> -- filename
```

---

## Quick Reference

### Essential Commands

```powershell
# Status & Info
git status                  # See current changes
git log --oneline -10      # View recent commits
git branch                 # List branches (* = current)
git diff                   # See unstaged changes

# Branch Operations
git checkout -b new-branch # Create and switch to new branch
git checkout branch-name   # Switch to existing branch
git branch -d branch-name  # Delete local branch

# Staging & Committing
git add filename           # Stage specific file
git add .                  # Stage all changes
git commit -m "message"    # Commit staged changes

# Syncing with Remote
git pull                   # Get latest from remote
git push                   # Push commits to remote
git fetch                  # Download remote changes (no merge)

# Merging
git merge branch-name      # Merge branch into current branch

# Undo Operations
git restore filename       # Discard unstaged changes
git reset HEAD~1          # Undo last commit, keep changes
git stash                 # Temporarily save changes
git stash pop             # Restore stashed changes
```

### Branch Naming Conventions

```
feature-<description>    # New features
fix-<description>        # Bug fixes
refactor-<description>   # Code refactoring
update-<description>     # Updates to existing features
docs-<description>       # Documentation only
test-<description>       # Test additions/changes

Examples:
- feature-user-authentication
- fix-login-validation-bug
- refactor-database-queries
- update-api-endpoints
```

### Commit Message Format

```
<type>: <subject>

<optional body>

<optional footer>

Types:
- feat: New feature
- fix: Bug fix
- refactor: Code refactoring
- docs: Documentation
- test: Tests
- chore: Maintenance

Examples:
"feat: Add user authentication with JWT"
"fix: Resolve login validation error"
"refactor: Improve database query performance"
```

---

## Visual Workflow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    FEATURE DEVELOPMENT                      │
└─────────────────────────────────────────────────────────────┘

START
  │
  ├─ git checkout main
  ├─ git pull origin main
  │
  ├─ git checkout -b feature-name
  │
  ├─ [Make changes]
  ├─ git add .
  ├─ git commit -m "message"
  ├─ git push -u origin feature-name
  │
  ├─ [More changes and commits...]
  │
  ├─ git checkout main
  ├─ git pull origin main
  ├─ git checkout feature-name
  ├─ git merge main
  │
  ├─ [Test everything works]
  │
  ├─ git checkout main
  ├─ git pull origin main (one more time!)
  ├─ git merge feature-name --no-ff
  ├─ git push origin main
  │
  └─ DONE ✅

Optional:
  ├─ git branch -d feature-name
  └─ git push origin --delete feature-name
```

---

## Best Practices Summary

1. **Never work directly on main** - Always use feature branches
2. **Commit early, commit often** - Small, logical commits are better
3. **Write good commit messages** - Your future self will thank you
4. **Pull before you push** - Always get latest changes first
5. **Test before merging to main** - Main should always be deployable
6. **Push your branches** - Back up your work regularly
7. **Keep branches short-lived** - Merge back to main frequently (daily if possible)
8. **Clean working directory** - Commit or stash before switching branches
9. **Review before committing** - Use `git status` and `git diff`
10. **Communicate with team** - Coordinate on shared branches

---

## Need Help?

### Useful Git Commands for Debugging

```powershell
# See all branches and their relationships
git log --oneline --graph --all -20

# See what branch you're on
git branch

# See remote branches
git branch -r

# See difference between branches
git diff branch1..branch2

# See which commits are in branch1 but not branch2
git log branch2..branch1

# See status of all branches compared to remote
git branch -vv
```

### When Things Go Wrong

1. **Don't panic** - Git rarely loses data
2. **Check status** - `git status` tells you a lot
3. **Check history** - `git log --oneline --graph`
4. **Google the error** - Git errors are well-documented
5. **Ask for help** - Provide the error message and what you were trying to do

---

## Glossary

- **Repository (repo)**: The project and its complete history
- **Branch**: An independent line of development
- **Commit**: A snapshot of your changes
- **Stage/Staging Area**: Changes marked to be included in next commit
- **Working Directory**: Your current file system
- **Remote**: The version of your repository hosted online (GitHub)
- **Origin**: The default name for your remote repository
- **HEAD**: A pointer to your current branch/commit
- **Merge**: Combining changes from different branches
- **Conflict**: When Git can't automatically merge changes
- **Pull**: Get changes from remote and merge them
- **Fetch**: Get changes from remote but don't merge
- **Push**: Send your commits to remote
- **Stash**: Temporarily save uncommitted changes

---

## PowerShell-Specific Notes

Since you're using PowerShell on Windows:

1. **Line continuation**: Use backtick `` ` `` at end of line
   ```powershell
   git commit -m "Line 1" `
              -m "Line 2"
   ```

2. **Path separators**: Use forward slashes `/` in git commands
   ```powershell
   git add frontend/src/App.tsx  # Good
   ```

3. **Multi-line strings**: Use double quotes and backtick
   ```powershell
   git commit -m "First line`nSecond line"
   ```

4. **Checking if git command exists**:
   ```powershell
   git --version
   ```

---

**Remember**: Git is a safety net. It's designed to help you, not hurt you. With this workflow, you'll always know where your code is and how to get it where it needs to be!

*Last updated: January 28, 2026*
