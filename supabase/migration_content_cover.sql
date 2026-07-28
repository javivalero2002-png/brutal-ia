-- Portada / cover image para piezas de contenido
ALTER TABLE content_agenda ADD COLUMN IF NOT EXISTS cover_url TEXT;
