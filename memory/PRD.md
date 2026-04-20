# Tom Certo — PRD

## App Overview
Detector de tonalidade musical em tempo real para músicos de igreja.
Detecta a tonalidade (tom) de músicas cantadas ou tocadas via microfone.

## Arquitetura
- **Frontend**: Expo React Native (SDK 54), expo-router
- **Backend**: FastAPI + MongoDB (Motor)
- **Auth**: JWT (admin) + Token de acesso por código
- **Algoritmo**: YIN pitch detection + Krumhansl-Schmuckler key-finding

## Implementado (19/04/2026)

### Backend (`/app/backend/server.py`)
- `POST /api/auth/validate` — Valida token de acesso do usuário, vincula device_id
- `POST /api/auth/revalidate` — Revalida sessão JWT do app
- `POST /api/admin/login` — Login admin com JWT
- `POST /api/admin/tokens` — Cria token de acesso
- `GET /api/admin/tokens` — Lista tokens (com filtros)
- `POST /api/admin/tokens/{id}/revoke` — Revoga token
- `DELETE /api/admin/tokens/{id}` — Remove token
- `GET /api/admin-ui` — Painel admin (HTML)
- `GET /api/health` — Health check

### Frontend
- **Tela de Ativação** (`src/auth/ActivationScreen.tsx`) — Input de token, animações, validação
- **Tela Principal** (`app/index.tsx`) — 3 telas: Initial, Listening, Detected
- **AuthContext** (`src/auth/AuthContext.tsx`) — Gerenciamento de sessão (SecureStore)
- **deviceId** (`src/auth/deviceId.ts`) — ID único do dispositivo
- **storage** (`src/auth/storage.ts`) — SecureStore / localStorage
- **YIN** (`src/audio/yin.ts`) — Algoritmo de detecção de pitch
- **usePitchEngine** (`src/audio/usePitchEngine.ts`) — Hook nativo usando `@siteed/audio-studio` (PCM Float32 real-time)
- **usePitchEngine.web** (`src/audio/usePitchEngine.web.ts`) — Fallback web (Web Audio API)
- **keyDetector** (`src/utils/keyDetector.ts`) — Krumhansl-Schmuckler
- **noteUtils** (`src/utils/noteUtils.ts`) — Notas BR/Internacional, campo harmônico
- **useKeyDetection** (`src/hooks/useKeyDetection.ts`) — Hook principal de detecção

### Build Android (APK)
- **app.json** — `android.package=com.tomcerto.app`, `versionCode=1`, permissão `RECORD_AUDIO`, plugin `@siteed/audio-studio` configurado
- **eas.json** — Perfis `development`, `preview` (APK), `production` (AAB), `production-apk` (APK)
- Comando: `eas build -p android --profile preview` gera APK instalável
- Ver `/app/frontend/BUILD_ANDROID.md` para passo a passo completo

## Credenciais
- Admin: admin / tomcerto2025
- Admin UI: /api/admin-ui
- Token de teste: 9ME76RH5ZAN5

## Backlog

### P0 (Crítico)
- Nenhum pendente

### P1 (Importante)
- Validar detecção nativa no APK (build em dispositivo real)
- Teste de latência de pitch em ambiente live
- Push notifications para expiração de token

### P2 (Melhoria)
- Histórico de tonalidades detectadas
- Compartilhamento de tom detectado
- Múltiplos idiomas (notação internacional padrão)
- Afinador cromático
- Metronômo integrado

## Origem
Migrado do repositório https://github.com/Fernandozeyra/TomCertoApp.git em 19/04/2026
