# AutoApply AI - Vision & CDP Engine

This engine powers autonomous, resilient job applications across LinkedIn, Indeed, Wellfound, Naukri, and ATS portals (Greenhouse, Lever, Ashby, Workday) using [browser-use](https://github.com/browser-use/browser-use) over the Chrome DevTools Protocol (CDP).

### Features
- **Visual Grounding**: Multimodal LLM vision recognizes form fields, buttons, and modals regardless of dynamic or atomic CSS changes.
- **Native CDP Execution**: Dispatches trusted hardware-level mouse/keyboard events and direct file uploads (`DOM.setFileInputFiles`).
- **Zero Hallucination Guardrails**: Strictly adheres to candidate profile credentials without fabricating metrics or unmentioned technologies.
- **Semi-Auto & Full-Auto Modes**: Semi-auto pauses at the final review step for user/agent approval.
