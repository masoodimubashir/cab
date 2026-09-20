# Deployment checks

Run `bash backend/deploy/deploy.sh` from the VPS checkout. The script needs
Docker Compose v2 with `up --wait`, `flock`, and `curl` (or the existing
bare-metal PHP/Composer setup). Keep `APP_KEY` configured in `backend/.env`.

The Docker path builds before replacing containers, waits up to 180 seconds
for PHP-FPM readiness, validates and gracefully reloads nginx, then requests
`https://dreamcabs.in/up` through the local HTTPS listener. The successful
commit marker is written only after these checks pass. A missing marker means
a full build; it does not guess the deployed revision from Git history.

Nginx uses Docker DNS to refresh PHP and Reverb addresses when containers are
replaced. The configuration requires nginx 1.27.3 or newer (the existing
1.27-alpine image provides this). Release tasks run only in the app entrypoint;
the deploy script does not repeat them or restart the workers a second time.
Uploads are excluded from the image build context, and storage ownership is
repaired once per volume instead of recursively on every container start.

## Private frontend configuration

Before deployment, provision `environment.ts` and `environment.prod.ts` in
`$HOME/dreamcabs-config/frontend` for the SSH deployment user. Keep the parent
directory mode 700 and files mode 600. These are the complete Angular environment
files, with the replacement Maps key supplied privately. Never commit them.
An explicit `DREAMCABS_FRONTEND_CONFIG_DIR` overrides the directory when needed.

The deployment script requires both files and restores them to the checkout
before building. It always rebuilds the frontend to apply private configuration
changes and retries. Missing configuration stops deployment before services are
replaced. GitHub Actions must use the user owning the private configuration (or
set the override to a directory that its SSH user can read).

The production GitHub workflow explicitly selects
`/home/dreamcabs/dreamcabs-config/frontend`, the location confirmed by the user.
It checks both files are readable and nonempty before pulling changes. This
works for `dreamcabs` or `root` with the existing private permissions; another
SSH user will fail the check and needs deliberately provisioned access. Do not
make the files world-readable or change SSH credentials to bypass this check.
For manual deployment under a different user, set the same directory override.

## Availability limit

This is still a single-app-container deployment. Requests can fail briefly
between stopping the old PHP container and the new one becoming ready. These
changes address stale upstream addresses, startup races, and false success
reports; they do not provide zero downtime or automatic rollback. That needs
a second application instance, a readiness-gated traffic switch, and
backward-compatible database migrations.

## If a deployment fails

On the VPS, inspect:

```sh
cd /var/www/dreamcabs/backend
docker compose ps
docker compose logs --tail=100 app nginx
```

Fix the reported startup, migration, or configuration error before rerunning.
Do not delete database or storage volumes to resolve a deployment failure.
If an old storage volume needs another full ownership repair, remove only
`storage/.permissions-v1` inside that volume before restarting the app.

## Local checks

`node scripts/test-deployment.cjs` runs the actual deployment and entrypoint
scripts against mocked commands in temporary directories. It checks successful
deployments, skipped builds, failure handling, readiness/reload order, release
tasks, and one-time permissions. It does not replace a Docker/VPS smoke test.

Production deploys from GitHub Actions are serialized. The server-side lock
also prevents two deployment scripts from running together; avoid manual
checkout changes or `git pull` while any release is running.
