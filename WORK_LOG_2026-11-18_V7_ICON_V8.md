# Recipe Master Plus — работен лог
## Състояние към 18.11.2026, 12:45 ч. (Europe/Sofia)

### 1. Текуща версия и потвърдени тестове
- Последна компилирана версия: **APK v7**.
- GitHub Actions run: https://github.com/pepokachev-sketch/Recipe-Master-plus/actions/runs/44292802806
- Компилацията на v7 е завършила успешно.
- Потребителят инсталира и тества v7.
- Възстановяването на JSON архив е успешно.
- Първият и повторният JSON export са тествани от потребителя и според обратната му връзка работят нормално.
- Приложението като цяло изглежда нормално, с изключение на проблема с иконката.

### 2. Нов проблем: Android launcher иконка
**Симптом:** След инсталиране на APK v7 иконката на Recipe Master Plus на телефона е заменена с общата Android иконка.

**Проверени факти от проекта:**
- `icons/icon-512.svg` съществува и е основната графика на приложението.
- `icons/odin-wolf.svg` също съществува.
- `manifest.webmanifest` сочи към `./icons/icon-512.svg`.
- `scripts/prepare-android-web.mjs` копира директорията `icons` в Android web bundle.
- `capacitor.config.json` съдържа appId `com.recipemaster.app` и appName `Recipe Master Plus`.
- Workflow генерира чист Android проект чрез `npx cap add android`, след което изпълнява `npx cap sync android`.
- В проверения workflow няма отделна стъпка за генериране на Android launcher иконки в PNG/mipmap ресурсите.

**Работна хипотеза:** SVG иконките се използват от уеб приложението/PWA, но не се преобразуват автоматично в Android launcher ресурси. Това вероятно е причината Android да показва стандартната иконка. Потвърди чрез проверка на генерирания Android manifest и ресурсите след компилацията.

### 3. Одобрена следваща задача
Потребителят изрично одобри:
1. Да се поправи генерирането на Android launcher иконките.
2. Да се използва съществуващата оригинална графика на Recipe Master Plus.
3. Да се добави автоматична проверка в CI, че launcher ресурсите са генерирани и конфигурирани.
4. Да се компилира нов **APK v8**.

### 4. Ограничения и правила за безопасност
- Не променяй `main`.
- Не сливай PR #4 без изрично разрешение.
- Работи в отделен branch, базиран на текущия branch за Android backup поправката.
- Запази вече потвърдената поправка за повторен JSON export.
- Не променяй import/restore логиката без необходимост.
- Не заявявай, че иконката е поправена, преди да се провери APK и потребителят да потвърди резултата на телефона.
- Нов APK е необходим: launcher иконката е вградена в APK ресурсите и не може да се подмени дистанционно в вече инсталирания v7.

### 5. GitHub състояние
- Репозиториум: https://github.com/pepokachev-sketch/Recipe-Master-plus
- Текущ branch: `fix/android-backup-existing-directory-2026-11-18`
- Последен известен commit преди тази задача: `64a4547ae8d43d6a1be2b32f273ba40ee655fadb`
- PR #4: https://github.com/pepokachev-sketch/Recipe-Master-plus/pull/4
- PR #4 е отворен и не е слят.
- `main` не е променян.
- Workflow файл: `.github/workflows/android-validation.yml`
- Android web preparation script: `scripts/prepare-android-web.mjs`
- Capacitor config: `capacitor.config.json`

### 6. Следващи технически стъпки
1. Създай отделен branch от `fix/android-backup-existing-directory-2026-11-18`, например `fix/android-launcher-icon-v8-2026-11-18`.
2. Провери актуалната Capacitor CLI поддръжка за генериране на Android launcher ресурси и точните опции на `@capacitor/assets`/официалния подход, преди да добавяш зависимост или команда.
3. Генерирай нужните PNG ресурси и adaptive icon ресурси от оригиналната графика. Провери foreground/background и legacy launcher иконката.
4. Увери се, че Android manifest сочи към правилното `@mipmap` launcher resource.
5. Добави CI проверки за наличието на ресурсите и правилната manifest конфигурация.
6. Стартирай тестовете и компилацията с versionCode/versionName за v8.
7. Провери APK артефакта и логовете на workflow.
8. Дай на потребителя линк към новия артефакт и инструкции за инсталация/проверка.
9. Потребителят трябва да потвърди, че оригиналната иконка се вижда на началния екран.

### 7. Как да продължим този лог
При следващ разговор потребителят може да каже:
**„Продължи Recipe Master Plus от лога 18.11.2026 — поправката на иконката за APK v8.“**

Започни от точка 1 в раздел 6. Не започвай отначало и не повтаряй вече приключилите тестове на v7.