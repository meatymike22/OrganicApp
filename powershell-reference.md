# PowerShell Command Reference

## Basic navigation & file operations

| Task | Command | Notes |
|---|---|---|
| Change directory | `cd path\to\folder` | |
| List files in current folder | `dir` | Same as `ls` on Mac/Linux |
| List files in a specific folder | `dir path\to\folder` | |
| List files matching a pattern | `dir .env*` | Useful for catching `.env.txt` mistakes |
| View a file's contents | `type filename.ext` | Same as `cat` |
| Create a folder | `mkdir foldername` | |
| Create a new file (forces exact name, avoids `.txt` auto-append) | `notepad filename.ext` | Say "yes" when it asks to create a new file |
| Rename a file | `ren oldname.ext newname.ext` | |
| Delete a folder and everything in it | `rmdir /s /q foldername` | `/s` = recursive, `/q` = no confirmation prompt |
| Copy a file | `copy source.ext destination.ext` | |

## Fixing "running scripts is disabled" (npx/npm blocked)

Run PowerShell **as Administrator**, then:
```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
Type `Y` to confirm. One-time fix — after this, regular npm/npx commands work in a normal (non-admin) terminal.

## Fixing folder permission / ownership errors (`EPERM`, can't write to a folder)

Run as Administrator:
```
takeown /f "D:\path\to\folder" /r /d y
icacls "D:\path\to\folder" /grant "YourWindowsUsername:F" /t
```
- `takeown` makes your account the actual owner of the folder and everything inside it
- `icacls` grants full control, recursively (`/t`)
- Find your exact username with `whoami` (shows `computername\username`)
- If your username has a space in it, keep the quotes: `"Michael McElroy:F"`
- **Note:** in PowerShell, `%username%` doesn't auto-expand like it does in Command Prompt — either type your username directly, or use `"$env:username`:F"` (with the backtick before the colon)

## Redirecting command output to a file

```
command > output.txt
```
Saves output to a file, but you won't see it live in the terminal.

```
command | Tee-Object -FilePath output.txt
```
Shows output live **and** saves it to a file.

```
command *>&1 | Tee-Object -FilePath output.txt
```
Same as above, but also captures error output, not just normal output.

*(Note: your ingestion scripts now write their own timestamped log files automatically to a `logs/` folder — you generally won't need to do this manually anymore for those.)*

## Git basics used in this project

| Task | Command |
|---|---|
| Initialize a repo | `git init` |
| Stage all changes | `git add .` |
| Commit staged changes | `git commit -m "message"` |
| Connect to a GitHub repo | `git remote add origin <repo-url>` |
| Rename branch to main | `git branch -M main` |
| Push for the first time | `git push -u origin main` |
| Check current line-ending setting | `git config --get core.autocrlf` |
| Stop Git from converting line endings | `git config --global core.autocrlf false` |

## Project-specific commands (this project)

| Task | Command |
|---|---|
| Start the dev server | `npm run dev` |
| Install a package | `npm install package-name` |
| Install a dev-only package | `npm install package-name --save-dev` |
| Apply schema changes to the database | `npx prisma migrate dev --name description-here` |
| Regenerate Prisma Client manually | `npx prisma generate` |
| Open the visual database browser | `npx prisma studio` |
| Check Prisma version/config | `npx prisma -v` |
| Dump the whole database to terminal + log file | `npx tsx scripts/dump-db.ts` |
| Run USDA ingestion (dry run) | `npx tsx scripts/ingest-usda.ts ./data/FILE.xlsx` |
| Run USDA ingestion (live, writes to DB) | `npx tsx scripts/ingest-usda.ts ./data/FILE.xlsx --live` |
| Run FDA recalls ingestion (dry run) | `npx tsx scripts/ingest-fda-recalls.ts` |
| Run FDA recalls ingestion (live) | `npx tsx scripts/ingest-fda-recalls.ts --live` |
| Search the USDA file for a name or cert number | `npx tsx scripts/search-usda.ts ./data/FILE.xlsx "search term"` |

## Quick troubleshooting checklist (things that bit us this session)

- **File won't run / 404 / "module not found":** check the file didn't accidentally save as `.txt` — `dir foldername` to check the real extension
- **`.env` not loading:** confirm it's named exactly `.env` (not `.env.txt`), sitting directly in the project root next to `package.json`
- **"Cannot find module" for a Prisma-related import:** run `npx prisma generate`
- **Database connection fails (`P1001`):** make sure you're using Supabase's **Session Pooler** connection string, not the direct `db.xxx.supabase.co` one (which requires IPv6 and often can't be reached)
- **New database rows have blank/empty `id`:** the schema needs `@default(dbgenerated("gen_random_uuid()"))`, not `@default(uuid())` — the latter only works through Prisma Client, not raw SQL or Studio inserts
