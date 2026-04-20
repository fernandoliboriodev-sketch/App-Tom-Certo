# Tom Certo — Guia de Build Android (APK)

Este guia explica como gerar um APK instalável do Tom Certo usando **EAS Build** (serviço oficial do Expo) ou build local.

---

## O que foi configurado

- **Captação de áudio 100% nativa** com `@siteed/audio-studio`
  - Streaming PCM Float32 em tempo real
  - Taxa de amostragem 16 kHz, janela YIN de 2048 samples (~128 ms)
  - Zero dependência de WebView ou Web Audio
- **Permissões Android**: `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `WAKE_LOCK`
- **Pacote**: `com.tomcerto.app`
- **Versão inicial**: `versionName 1.0.0`, `versionCode 1`
- **Fallback web** mantido (só para testar a UI no navegador)

---

## Pré-requisitos (executar uma única vez na sua máquina)

```bash
# 1. Node.js 20+ e Yarn instalados
node -v     # v20 ou superior
yarn -v

# 2. Instalar CLIs da Expo
npm install -g eas-cli
# ou
yarn global add eas-cli

# 3. Criar conta em https://expo.dev (gratuita) caso ainda não tenha
eas login
# → digite seu usuário e senha Expo
```

---

## 1. Build do APK na nuvem (recomendado — mais fácil)

Não precisa de Android Studio, Gradle ou JDK. A Expo compila tudo.

```bash
# Entrar na pasta do frontend
cd /app/frontend

# 1ª vez: configurar o projeto no EAS
eas init
# → aceite o nome do projeto (tom-certo)
# → isso adiciona um "projectId" no app.json

# Rodar o build APK (perfil "preview" = APK de teste)
eas build -p android --profile preview
```

O que acontece:
1. O EAS faz upload do código
2. Compila na infra deles (5-15 min)
3. Retorna um link `.apk` para download
4. Você instala no celular Android arrastando o APK ou via navegador

### Perfis disponíveis no `eas.json`
| Perfil | Formato | Uso |
|--------|---------|-----|
| `development` | APK (debug) | Dev client para desenvolvimento |
| `preview` | APK | **Teste em dispositivos reais (use este)** |
| `production-apk` | APK | APK final para distribuição direta |
| `production` | AAB | Google Play Store (bundle assinado) |

---

## 2. Build local (opcional — só se quiser compilar na sua máquina)

Requer Android Studio + JDK 17 + Android SDK configurados.

```bash
cd /app/frontend

# Gera as pastas /android e /ios
npx expo prebuild --platform android

# Compila APK debug
cd android
./gradlew assembleRelease
# APK fica em android/app/build/outputs/apk/release/app-release.apk
```

---

## 3. Publicar na Play Store (quando estiver pronto)

1. Criar conta Google Play Console (USD 25 único)
2. Gerar keystore de assinatura (o EAS gera automaticamente na 1ª vez)
3. Build em produção:
   ```bash
   eas build -p android --profile production
   ```
   Isso gera um `.aab` (Android App Bundle) já assinado.
4. Submissão:
   ```bash
   eas submit -p android --profile production
   ```
   Antes, você precisa criar uma service-account JSON no Google Play Console e salvar como `./play-store-service-account.json`.

### Checklist Play Store
- [ ] Ícone 512×512 PNG em `assets/images/icon.png`
- [ ] Gráfico 1024×500 (feature graphic)
- [ ] Screenshots (2-8 por formato)
- [ ] Descrição curta (80 chars) + completa (4000 chars)
- [ ] Política de privacidade (URL pública)
- [ ] Classificação de conteúdo (questionário no console)
- [ ] Declaração de permissões (RECORD_AUDIO = "captar áudio para detectar tom")

---

## 4. Atualizar versão a cada novo release

Edite `app.json`:
```json
{
  "expo": {
    "version": "1.0.1",             // versionName visível ao usuário
    "android": {
      "versionCode": 2              // inteiro incremental obrigatório pela Play Store
    }
  }
}
```

Depois rode `eas build` novamente.

---

## 5. Variável de backend (IMPORTANTE)

O APK final precisa apontar para a URL correta do backend FastAPI. Edite `eas.json` e ajuste `EXPO_PUBLIC_BACKEND_URL` em cada perfil:

```json
"env": {
  "EXPO_PUBLIC_BACKEND_URL": "https://seudominio.com"
}
```

Se não tiver domínio ainda, você pode usar a URL atual do sandbox para testes iniciais:
```
https://account-linker-10.preview.emergentagent.com
```

---

## 6. Testando o APK

1. Ative "Fontes desconhecidas" no Android
2. Baixe o `.apk` pelo link que o EAS fornece
3. Instale
4. Abra → aceite a permissão de microfone
5. Cole um token válido (ex: `9ME76RH5ZAN5`)
6. Toque em "Detectar Tom"

> Na primeira execução o Android pede permissão explícita de microfone. Se o usuário negar, o app mostra instrução para liberar manualmente nas Configurações.

---

## Problemas comuns

| Sintoma | Causa | Solução |
|---------|-------|---------|
| `Gradle build failed` | Cache corrompido no EAS | `eas build --clear-cache` |
| Sem detecção de áudio no APK | Permissão negada | Configurações → Tom Certo → Permissões → Microfone |
| `Project not configured` | Falta `eas init` | Rode `eas init` na pasta `/app/frontend` |
| App crash ao iniciar | Plugin `@siteed/audio-studio` não prebuild | Force um novo build (`eas build --clear-cache`) |

---

## Resumo dos comandos essenciais

```bash
cd /app/frontend
eas login
eas init                                   # 1ª vez
eas build -p android --profile preview     # gera APK de teste
```

Pronto — depois é só baixar o APK e instalar no celular. 🎵
