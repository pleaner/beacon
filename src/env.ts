import type { User } from './lib/db'

export type AppEnv = {
  Bindings: Env
  Variables: { user: User | null }
}
