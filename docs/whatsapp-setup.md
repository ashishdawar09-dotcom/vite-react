# WhatsApp updates: setup

Players can choose to get two kinds of WhatsApp message:

- **The evening before** (6–9 pm Pacific): "Get ready: *Tournament* is tomorrow", with the start time and venue.
- **On game day**: "you're up now on *Court N*", when an admin assigns a court. This goes out alongside the email and push that `notify-court-allocated` already sends.

**Opt-in only.** The registration confirmation screen has a **Get updates on WhatsApp** button. It opens WhatsApp with a message to the club number holding the player's code, e.g. *"Hi! Please send me WhatsApp updates for Shuttle Storm. My code: 1A2B3C4D"*. Sending it is the opt-in. We reply once to confirm, and players can send STOP (or START) at any time. Anyone who hasn't messaged us first is never messaged.

Messages go through [Evolution API](https://github.com/EvolutionAPI/evolution-api), a server we host ourselves. It's linked to a spare phone the same way WhatsApp Web is, so there's no per-message cost.

Nothing is sent until all of these are in place:

1. the Evolution server is running, linked to the phone, with its webhook pointing at us,
2. the Supabase secrets are set and the functions deployed,
3. **WhatsApp updates** is ticked and the **club WhatsApp number** filled in, in the tournament's settings (Edit → Player messages).

Until then the button doesn't show, and email and push work as before.

## Before you start: the risks

- This is not Meta's official API. WhatsApp can ban the number, even when it's used gently. Opt-in keeps the risk low: we only message people who wrote to us first, who are unlikely to report us. **Use a spare SIM, ideally in a spare phone, never a personal number.** If the number is banned, email and push still go out and the tournament carries on.
- The phone has to stay linked. If WhatsApp logs the session out, you scan the QR code again.
- Evolution API's license (Apache 2.0 plus extra terms) requires keeping their logo in their manager screens, and showing admins that Evolution API is used. The tournament settings checkbox mentions it. As a courtesy, email suporte@evofoundation.com.br to say you're using it.

## 1. The phone

1. Put the spare SIM in a phone and install **WhatsApp Business** (free). Set the profile name to "Shuttle Storm" and add the logo, so players see who they're writing to.
2. Use the number normally for a few days before switching the button on: save a few contacts and chat with them. Brand-new numbers that start sending straight away get banned more often.
3. Keep the phone charged and online with WhatsApp installed. It doesn't need to be open.

People will also write to this number with questions. Those get no automatic reply. Read and answer them on the phone as normal.

## 2. The server (runs all the time)

Opt-ins arrive whenever people register, so the server has to run continuously from the day the button goes live, not only on tournament days.

**What we run (set up 2026-10-29):** a DigitalOcean droplet `shuttlestorm-whatsapp` in Toronto (Basic, 1 GB, $6/month, Ubuntu 24.04), logged into with an SSH key only. It has:
- a ufw firewall with only SSH open,
- unattended-upgrades for security updates,
- 2 GB of swap,
- Docker from Ubuntu's own packages (`docker.io`, `docker-compose-v2`).

Evolution lives in `/opt/evolution`, along with `webhook-secret` (password 3 below).

Any small Linux server works the same way (the Oracle Cloud free tier is another option). Install Docker, then make a folder with these two files.

`docker-compose.yml`:

```yaml
services:
  api:
    image: evoapicloud/evolution-api:v2.3.7
    restart: always
    depends_on: [postgres]
    ports:
      - "127.0.0.1:8080:8080"   # only reachable through the tunnel below
    env_file: .env
    volumes:
      - evolution_instances:/evolution/instances

  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  evolution_instances:
  postgres_data:
```

`.env` (fill in the two passwords; generate each with `openssl rand -hex 24`):

```
POSTGRES_PASSWORD=<password 1>
SERVER_URL=https://wa.adawar.org
AUTHENTICATION_API_KEY=<password 2>
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:<password 1>@postgres:5432/evolution?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=evolution
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
CONFIG_SESSION_PHONE_CLIENT=Shuttle Storm
CONFIG_SESSION_PHONE_NAME=Chrome
```

Start it with `docker compose up -d`. Check `docker compose logs -f api` until it says it's listening on 8080.

Evolution keeps its own small Postgres on the VM. It doesn't touch the tournament database.

## 3. A public address (Cloudflare Tunnel, free)

Supabase needs to reach the server over HTTPS. adawar.org is already on Cloudflare, so:

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** (type *Cloudflared*). Name it `whatsapp`.
2. Run the install command it shows on the server.

   We used the CLI on the server instead: `cloudflared tunnel login` (approve adawar.org in the browser), then `cloudflared tunnel create shuttlestorm-whatsapp`, `cloudflared tunnel route dns shuttlestorm-whatsapp wa.adawar.org`, an `/etc/cloudflared/config.yml` that sends `wa.adawar.org` to `http://127.0.0.1:8080`, and `cloudflared service install`.
3. Add a **public hostname**: `wa.adawar.org` → service `HTTP` → `localhost:8080`.

Every request needs the API key (password 2), so the address being public is fine.

## 4. Link the phone

1. Open `https://wa.adawar.org/manager` and log in with the API key.
2. **Create instance**: name `shuttlestorm`, channel *Baileys*.
3. Open the instance, get the QR code, and on the phone go to **WhatsApp → Settings → Linked devices → Link a device** and scan it.
4. The instance should show **open** / connected.

## 5. Supabase: deploy and secrets

**Release order matters.** The new frontend reads the two new tournament columns. If it goes live (Vercel deploys on merge) before the migration, every tournament page breaks. The migration on its own changes nothing visible, so always do it in this order:

1. migration (`supabase db push`),
2. functions,
3. merge the pull request.

From the `vite-react` repo, check that only this branch's migration is pending, then push it:

```bash
supabase db push --dry-run
```

```bash
supabase db push
```

Check that the new columns are readable before going on:

```bash
supabase db query --linked "select whatsapp_enabled, whatsapp_number from tournaments limit 1"
```

```bash
supabase functions deploy whatsapp-inbound whatsapp-send whatsapp-reminders notify-court-allocated
```

Generate the webhook secret (password 3) with `openssl rand -hex 24`, then:

```bash
supabase secrets set EVOLUTION_API_URL=https://wa.adawar.org EVOLUTION_API_KEY=<password 2> EVOLUTION_INSTANCE=shuttlestorm WHATSAPP_WEBHOOK_SECRET=<password 3>
```

The migration created the secret the database uses to wake the functions. Copy it into the functions' secrets without printing it:

```bash
WA_SECRET="$(supabase db query --linked --output-format json "select decrypted_secret as s from vault.decrypted_secrets where name = 'whatsapp_internal_secret'" | jq -r '(if type == "array" then . else .rows end)[0].s')"
```

It must be exactly 64 characters. If this prints anything else, stop and look:

```bash
echo -n "$WA_SECRET" | wc -c
```

```bash
supabase secrets set WHATSAPP_INTERNAL_SECRET="$WA_SECRET"
```

Then merge the pull request.

## 6. Point Evolution's webhook at us

This tells Evolution to forward incoming messages (the opt-ins, STOP, START) to `whatsapp-inbound`:

```bash
curl -s -X POST https://wa.adawar.org/webhook/set/shuttlestorm \
  -H "apikey: <password 2>" -H "Content-Type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-inbound","headers":{"x-webhook-secret":"<password 3>"},"byEvents":false,"base64":false,"events":["MESSAGES_UPSERT"]}}'
```

## 7. Test it, then switch it on

1. In the tournament settings, fill in the **club WhatsApp number** and tick **WhatsApp updates**.
2. From your own phone, send the club number `My code: <code>`, using the first 8 characters of one of your own registrations' IDs. You should get the ✅ reply within a minute. Send `STOP`, then `START`, and check you get those replies too.
3. Dry run: who would get the day-before message, and who hasn't opted in. Nothing is sent. Use your admin access token (in the admin app's browser console: `JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('-auth-token')))).access_token`):

```bash
curl -s -X POST https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-reminders -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","dry_run":true}'
```

To see what the day-before message looks like, send it to **your own number** only. This one skips the opt-in, so never use it for anyone else:

```bash
curl -s -X POST https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-reminders -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","test_number":"778 555 0123"}'
```

## Inviting people who registered before the button

`whatsapp-invite` emails everyone who registered before the tournament's WhatsApp switch went on (`whatsapp_enabled_at`) an invitation with their own code: one email per person, partners included, skipping anyone who already opted in or stopped. `whatsapp_invites` records each email sent, so nobody gets it twice. Admins only.

Before the first send:

1. Upload `whatsapp-hero.gif` and `whatsapp-avatar.png` next to the other email images at https://shuttlestorm.adawar.org/email/.
2. Add WhatsApp to the privacy page (the email links to it).
3. Deploy the partner-code and invites migrations and the new `whatsapp-inbound`, and check a partner code works from your own phone.

Then work through the modes in order:

```bash
F=https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-invite
# Who would get it, and who is skipped and why. Sends nothing.
curl -s -X POST $F -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","mode":"dry_run"}'
# The email for person number 0 on that list, as JSON.
curl -s -X POST $F -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","mode":"preview","index":0}'
# That email, sent to a director's address only, with [TEST] in the subject.
curl -s -X POST $F -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","mode":"test","index":0,"to":"you@example.com"}'
# The real thing, 40 per call: repeat while "remaining" is above 0.
curl -s -X POST $F -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","mode":"send"}'
```

The sign-off, the club's WhatsApp profile name and the sender address under the email default to Shuttle Storm's. Override them with the `EMAIL_SIGNOFF`, `WHATSAPP_PROFILE_NAME` and `EMAIL_SENDER_ADDRESS` secrets.

## How it works

- **Opt-in** (`whatsapp-inbound`): the registrant's code is the first 8 characters of the registration ID, and their doubles partner's code is the last 8. The opt-in is stored in `whatsapp_optins` with the chat it came from, and updates go to that chat. Up to 3 chats can opt in for one entry, e.g. a player and a parent. A player can opt in before their entry is approved; they get updates once it is.
- **STOP / START**: STOP sets `opted_out_at` for every entry on that chat and cancels anything queued for it. START clears it.
- **Two IDs per chat**: a WhatsApp chat has a phone ID and a private `@lid` ID, and each message carries only one. They're tied together only on a join, where the sender has the code, if the entry already has an opt-in under the other form with the same WhatsApp profile name. The phone ID is the one we send to. STOP and START never redirect anyone's updates. A STOP from an unknown chat is ignored, unless an opt-in stored under the other form has the same WhatsApp name: one match is opted out, and several get an email to the organisers of those tournaments (at most 1 per sender and 10 overall a day). START from an unknown chat does nothing; the player can use the button again.
- **Queue** (`whatsapp_outbox`, `whatsapp-send`): every message is queued, then sent one at a time by a single sender, 2–4 s apart (5–9 s for day-before messages). Replies and court calls go first. A failed message is retried a minute later, 3 tries in total. The functions wake the sender when they queue something, and pg_cron checks every minute as a backstop.
- **Dropped instead of sent late**:
  - a court call still unsent after 20 minutes ("you're up now" would be wrong by then),
  - a court call for a match moved to another court,
  - a day-before message once the tournament day has started,
  - a reply more than a day old,
  - anything for a tournament whose switch has been turned off.
- **Day before**: between 6 and 9 pm Pacific on the day before a tournament with WhatsApp on, pg_cron calls `whatsapp-reminders` every 5 minutes. Each chat is queued once, so people who opt in that evening still get it. If a message fails 3 times (the phone was offline, say), a later run that evening queues it again, up to 2 rounds per chat.
- **Court calls**: `notify-court-allocated` queues one message per chat on the match. Results are in `notification_log` with `channel = 'whatsapp'`. Players who haven't opted in are counted in the function's response, not logged.
- **Doubles partners** opt in with their own code (the last 8 characters). The button is only on the registrant's confirmation screen, so partners get their code from the invitation email.
- **To stop everything**: untick the setting. Anything already queued for that tournament is dropped. Or run `supabase secrets unset EVOLUTION_API_URL`.

## Tournament day

- Before the first match, check the instance shows connected in `/manager`. If it doesn't, scan the QR code again.
- `select status, count(*) from whatsapp_outbox group by 1;` shows whether anything is stuck or failing.
