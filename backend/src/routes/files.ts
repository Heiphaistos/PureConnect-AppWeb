import type { FastifyPluginAsync } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { requireAuth } from '../middleware/auth.js'

const ALLOWED_ROOTS = (process.env.FILE_EXPLORER_ROOTS ?? '/opt,/var/log,/etc,/home,/root,/var/www')
  .split(',')
  .map((r) => r.trim().replace(/\/+$/, ''))

function isPathAllowed(p: string): boolean {
  return ALLOWED_ROOTS.some((root) => p === root || p.startsWith(root + '/'))
}

function resolveSafe(inputPath: string): string {
  const resolved = path.resolve('/', (inputPath || '/opt').replace(/^\/+/, ''))
  if (!isPathAllowed(resolved)) throw new Error(`Accès refusé : chemin hors des répertoires autorisés`)
  // Symlink escape: si le chemin est un lien symbolique, vérifier que la cible réelle
  // reste elle aussi dans les répertoires autorisés.
  try {
    const real = fs.realpathSync(resolved)
    if (!isPathAllowed(real)) throw new Error(`Accès refusé : cible du lien symbolique hors des répertoires autorisés`)
  } catch (e) {
    // realpathSync échoue si le chemin n'existe pas encore (ex: écriture d'un nouveau fichier) —
    // dans ce cas on laisse passer, le check sur le répertoire parent suffit.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  return resolved
}

function safeStat(filePath: string): fs.Stats | null {
  try { return fs.lstatSync(filePath) } catch { return null }
}

function safeRealStat(filePath: string): fs.Stats | null {
  try { return fs.statSync(filePath) } catch { return null }
}

export const filesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // GET /api/files/roots — list accessible root directories
  app.get('/roots', async (_req, reply) => {
    const accessible = ALLOWED_ROOTS.filter((r) => {
      const s = safeRealStat(r)
      return s?.isDirectory()
    })
    return reply.send({ roots: accessible })
  })

  // GET /api/files/list?path=/opt/myapp — list directory contents
  app.get('/list', async (req, reply) => {
    const { path: inputPath = '/opt' } = req.query as { path?: string }
    let resolved: string
    try { resolved = resolveSafe(inputPath) } catch (e) {
      return reply.status(403).send({ error: (e as Error).message })
    }

    const stat = safeRealStat(resolved)
    if (!stat) return reply.status(404).send({ error: 'Chemin introuvable' })
    if (!stat.isDirectory()) return reply.status(400).send({ error: 'Ce chemin est un fichier, pas un dossier' })

    let names: string[]
    try { names = fs.readdirSync(resolved) } catch {
      return reply.status(403).send({ error: 'Permission refusée (lecture du répertoire)' })
    }

    const entries = names
      .map((name) => {
        const full = path.join(resolved, name)
        const lstat = safeStat(full)
        if (!lstat) return null
        const rstat = lstat.isSymbolicLink() ? safeRealStat(full) : lstat
        return {
          name,
          isDir: rstat?.isDirectory() ?? false,
          isSymlink: lstat.isSymbolicLink(),
          size: rstat?.isFile() ? rstat.size : 0,
          mtime: (rstat ?? lstat).mtime.toISOString(),
          mode: (lstat.mode & 0o777).toString(8).padStart(3, '0'),
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a!.isDir !== b!.isDir) return a!.isDir ? -1 : 1
        return a!.name.localeCompare(b!.name)
      })

    // Parent: null if parent is outside allowed roots
    const parentPath = path.dirname(resolved)
    const parent = resolved !== parentPath && isPathAllowed(parentPath) ? parentPath : null

    return reply.send({ path: resolved, parent, entries })
  })

  // GET /api/files/read?path=/opt/myapp/config.yml — read file text content
  app.get('/read', async (req, reply) => {
    const { path: inputPath } = req.query as { path?: string }
    if (!inputPath) return reply.status(400).send({ error: 'Paramètre path requis' })

    let resolved: string
    try { resolved = resolveSafe(inputPath) } catch (e) {
      return reply.status(403).send({ error: (e as Error).message })
    }

    const stat = safeRealStat(resolved)
    if (!stat) return reply.status(404).send({ error: 'Fichier introuvable' })
    if (stat.isDirectory()) return reply.status(400).send({ error: 'Est un répertoire' })
    if (stat.size > 2 * 1024 * 1024) return reply.status(413).send({ error: 'Fichier trop volumineux (limite 2 Mo)' })

    try {
      const content = fs.readFileSync(resolved, 'utf8')
      return reply.send({ path: resolved, content, size: stat.size, mtime: stat.mtime.toISOString() })
    } catch {
      return reply.status(415).send({ error: 'Fichier binaire ou illisible' })
    }
  })

  // PUT /api/files/write — write (overwrite) a text file
  app.put('/write', async (req, reply) => {
    const { path: inputPath, content } = req.body as { path?: string; content?: string }
    if (!inputPath || content === undefined) return reply.status(400).send({ error: 'path et content requis' })

    let resolved: string
    try { resolved = resolveSafe(inputPath) } catch (e) {
      return reply.status(403).send({ error: (e as Error).message })
    }

    const stat = safeRealStat(resolved)
    if (stat?.isDirectory()) return reply.status(400).send({ error: 'Est un répertoire' })
    if (content.length > 2 * 1024 * 1024) return reply.status(413).send({ error: 'Contenu trop volumineux (limite 2 Mo)' })

    try {
      fs.writeFileSync(resolved, content, 'utf8')
      return reply.send({ ok: true, path: resolved })
    } catch {
      return reply.status(500).send({ error: 'Écriture impossible' })
    }
  })

  // DELETE /api/files?path=/opt/myapp/old.log — delete a single file (not directories)
  app.delete('/', async (req, reply) => {
    const { path: inputPath } = req.query as { path?: string }
    if (!inputPath) return reply.status(400).send({ error: 'Paramètre path requis' })

    let resolved: string
    try { resolved = resolveSafe(inputPath) } catch (e) {
      return reply.status(403).send({ error: (e as Error).message })
    }

    const stat = safeStat(resolved)
    if (!stat) return reply.status(404).send({ error: 'Fichier introuvable' })
    if (stat.isDirectory()) return reply.status(400).send({ error: 'Suppression de répertoires désactivée' })

    try {
      fs.unlinkSync(resolved)
      return reply.send({ ok: true })
    } catch {
      return reply.status(500).send({ error: 'Suppression impossible' })
    }
  })
}
