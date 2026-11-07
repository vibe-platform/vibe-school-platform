$ErrorActionPreference = "Stop"
$env:NODE_ENV = "development"
$env:HOST = "127.0.0.1"
$env:API_PORT = "3101"
$env:WEB_PORT = "5174"
$env:DATABASE_URL = "file:../data/presentation/vibe.db"
$env:UPLOAD_DIR = "./data/presentation/uploads"
$env:DEV_AUTH = "false"
$env:ENABLE_TEST_LOGIN = "true"
$env:DEMO_MODE = "true"
$env:LEGAL_PD_CONSENT_REQUIRED = "false"
                                                                                                    
npm run dev
