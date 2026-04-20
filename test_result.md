#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Tornar o app Tom Certo 100% nativo Android com captação real de microfone
  (sem WebView/navegador), baixa latência, permissões corretas, e configurar
  EAS Build para gerar APK instalável. Preparar para Play Store futuramente.

frontend:
  - task: "Captação de áudio nativa com @siteed/audio-studio (PCM Float32 streaming)"
    implemented: true
    working: "NA"
    file: "src/audio/usePitchEngine.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Instalado @siteed/audio-studio 3.0.3. Criado hook usePitchEngine que usa
            useAudioRecorder com streamFormat:'float32', sampleRate 16000, janelas YIN
            de 2048 samples com 50% overlap. Permissão via AudioStudioModule.
            Web bundler ainda resolve .web.ts com fallback Web Audio API (Metro auto-resolve).
            Requer validação em APK real - não testável no Expo Go ou web preview.

  - task: "Permissões e configuração Android nativa"
    implemented: true
    working: "NA"
    file: "app.json"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            app.json atualizado com plugin @siteed/audio-studio configurado
            (enableBackgroundAudio:false, enableDeviceDetection:false para minimizar
            permissões). Package com.tomcerto.app, versionCode 1, version 1.0.0.
            Permissões RECORD_AUDIO e MODIFY_AUDIO_SETTINGS já presentes.

  - task: "EAS Build configurado para APK"
    implemented: true
    working: "NA"
    file: "eas.json"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Criado eas.json com 4 perfis: development (APK debug), preview (APK interno),
            production (AAB Play Store), production-apk (APK para distribuição direta).
            EXPO_PUBLIC_BACKEND_URL configurado em cada perfil. Aguarda build real pelo usuário.

  - task: "Guia completo de build Android"
    implemented: true
    working: true
    file: "BUILD_ANDROID.md"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: |
            Criado BUILD_ANDROID.md com passo a passo completo:
            eas login → eas init → eas build -p android --profile preview.
            Inclui checklist Play Store, troubleshooting e atualização de versão.

  - task: "Fallback web (Web Audio API) preservado"
    implemented: true
    working: true
    file: "src/audio/usePitchEngine.web.ts"
    stuck_count: 0
    priority: "low"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: |
            Hook usePitchEngine exportado também em arquivo .web.ts usando Web Audio API
            + YIN. Metro bundler auto-resolve. Bundle web compila (884 modules).
            Screenshot confirma que app carrega e tela principal aparece após login.

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 0
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Migração para captação nativa completa. Mudanças principais:
      
      1) @siteed/audio-studio 3.0.3 instalado e configurado como plugin Expo
      2) Refatoração: pitchEngine class-based → usePitchEngine hook-based
      3) Files:
         - src/audio/types.ts (novo - tipos compartilhados)
         - src/audio/usePitchEngine.ts (novo - nativo)
         - src/audio/usePitchEngine.web.ts (novo - fallback web)
         - src/hooks/useKeyDetection.ts (refatorado para usar hook)
         - app.json (plugin audio-studio + config)
         - eas.json (novo - 4 perfis de build)
         - BUILD_ANDROID.md (novo - guia do usuário)
         - Removidos: src/audio/pitchEngine.ts e .web.ts
      4) Native engine envia PCM Float32 em chunks 100ms → acumula em janelas 2048 samples
         @ 16kHz → YIN → pitchClass. Overlap 50% para responsividade.
      
      Web preview funciona para teste de UI (screenshot confirmado).
      Captação real requer APK construído via EAS. Usuário seguirá BUILD_ANDROID.md.
      
      Sem testes backend necessários - nenhuma mudança no backend.
