# Atividade Educativa UNASP — Plataforma de Registro de Presença

Site estático (GitHub Pages) + Supabase (projeto `te-unasp`, região São Paulo).

- Toda a segurança está no banco (RLS + funções em `schema.sql` / `migracao_002.sql`).
- A chave usada no `app.js` é a chave **pública (anon)** — sem login, nada é lido.
- **Nunca** coloque neste repositório: planilhas, exportações de alunos ou a chave `service_role`.

Papéis: **NAF** (tudo), **Líder** (só os próprios setores e subsetores), **Aluno** (só o próprio saldo).
