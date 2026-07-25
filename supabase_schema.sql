-- ============================================================
-- Tabla: projects
-- Cada fila = un proyecto guardado, vinculado a un usuario
-- ============================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id        TEXT PRIMARY KEY,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name      TEXT DEFAULT 'Sin titulo',
  slides    JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seguridad: solo el dueño puede leer/modificar sus proyectos
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios pueden leer sus propios proyectos"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden insertar sus proyectos"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden actualizar sus proyectos"
  ON public.projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden eliminar sus proyectos"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

-- Indice para busquedas por usuario
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);

-- Auto-actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_projects_updated_at ON public.projects;
CREATE TRIGGER trigger_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
