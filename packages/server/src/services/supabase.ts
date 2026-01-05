import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Client for auth operations (uses anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client for privileged operations (uses service role key)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
