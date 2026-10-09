# Setting up exp.pitechlab.com

A second copy of the site that deploys from the `experimental` branch, keeps its own data, and tells every visitor it's experimental. You change it freely with Claude, and promote to pitechlab.com only when you like what you see.

## One-time setup (about 15 minutes)

**1. GitHub Desktop: create the branch**
Branch → New Branch → name it `experimental`, based on `main` → **Publish branch**.

**2. Railway: create the environment**
Open the project → environment switcher at the top (it says *production*) → **New Environment** → name it `experimental` and choose to duplicate *production*. Then, in the new environment:

- **Service → Settings → Source**: set the branch to `experimental`.
- **Volume**: check that the service has its **own** volume, not production's. Experiments must never touch real data. If none is attached, add one.
- **Variables:**
  - `SCHOLARPI_CHANNEL` = `experimental`
  - `SCHOLARPI_STABLE_URL` = `https://pitechlab.com`
  - `SESSION_SECRET` = a **new** random value, so sign-ins don't carry across sites
  - `FRONTEND_ORIGIN` = `https://exp.pitechlab.com`
  - `ORCID_REDIRECT_URI` = `https://exp.pitechlab.com/api/auth/orcid/callback`
  - Remove `ETH_ADMIN_PRIVATE_KEY`, the Pinata keys and any other key that can act on real accounts, unless you deliberately want experiments to use them.

**3. Domain**
- Railway (experimental environment) → service → **Settings → Networking → Custom Domain** → `exp.pitechlab.com`.
- Porkbun → pitechlab.com → DNS → add a **CNAME**: host `exp`, answer = the target Railway shows. Add any verification TXT record it shows too.

## Day to day

- Ask Claude for a change. It works on `experimental`, runs the checks in `CLAUDE.md`, and pushes after you agree.
- Railway redeploys exp.pitechlab.com. Look at it there; a slim black strip at the top shows it's the experimental build.
- When you're happy, **promote it**: in GitHub Desktop, switch to `main` → Branch → **Merge into current branch** → `experimental` → Push. pitechlab.com updates.
- If an experiment goes wrong, nothing reached the main site: revert the commit on `experimental`.
