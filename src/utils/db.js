import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

let supabaseClient = null
try {
  if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
    supabaseClient = createClient(supabaseUrl, supabaseKey)
  }
} catch (e) { console.warn('Supabase init failed:', e) }

export const supabase = supabaseClient
export function getSupabase() { return supabaseClient }

export function isSupabaseReady() {
  return !!supabase
}

// === Auth ===
export async function signupUser(email, password, name) {
  if (!supabase) return null // No configurado
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
  if (error) {
    if (error.message?.includes('already') || error.message?.includes('exists')) return false
    throw error
  }
  return data?.user ? { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name || '' } : null
}

export async function loginUser(email, password) {
  if (!supabase) return null
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.message?.includes('Invalid') || error.message?.includes('invalid')) return false
    throw error
  }
  return data?.user ? { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name || '' } : null
}

export async function getSession() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.user ? { id: data.session.user.id, email: data.session.user.email, name: data.session.user.user_metadata?.full_name || '' } : null
}

export async function logoutUser() {
  if (supabase) await supabase.auth.signOut()
}

export async function loginWithGoogle() {
  if (!supabase) return
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  })
  if (error) throw error
  return data
}

// === Projects ===
export async function saveProject(project) {
  if (!supabase) return
  const session = await supabase.auth.getSession()
  const userId = session?.data?.session?.user?.id
  if (!userId) return
  const { data: existing } = await supabase.from('projects').select('id').eq('user_id', userId).eq('id', project.id).maybeSingle()
  if (existing) {
    await supabase.from('projects').update({ name: project.name, slides: JSON.stringify(project.slides), updated_at: new Date().toISOString() }).eq('id', project.id)
  } else {
    await supabase.from('projects').insert({ id: project.id, user_id: userId, name: project.name, slides: JSON.stringify(project.slides), updated_at: new Date().toISOString() })
  }
}

export async function loadProject(id) {
  if (!supabase) return null
  const { data } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  return { id: data.id, name: data.name, slides: typeof data.slides === 'string' ? JSON.parse(data.slides) : data.slides, updatedAt: new Date(data.updated_at).getTime() }
}

export async function listProjects() {
  if (!supabase) return []
  const session = await supabase.auth.getSession()
  const userId = session?.data?.session?.user?.id
  if (!userId) return []
  const { data } = await supabase.from('projects').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
  return (data || []).map(p => ({ id: p.id, name: p.name, slides: typeof p.slides === 'string' ? JSON.parse(p.slides) : p.slides, slidesCount: p.slides?.length || 1, updatedAt: new Date(p.updated_at).getTime() }))
}

export async function deleteProject(id) {
  if (!supabase) return
  await supabase.from('projects').delete().eq('id', id)
}
