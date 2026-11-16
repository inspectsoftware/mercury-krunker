//! Renderer processes: run the page script in krunker.io's main frame before the page's own scripts, and carry
//! the renderer half of the message router (`cefQuery`).

use crate::browser::HOME;
use cef::{
    wrapper::message_router::{
        MessageRouterConfig, MessageRouterRendererSide, MessageRouterRendererSideHandlerCallbacks, RendererSideRouter,
    },
    *,
};
use std::{cell::RefCell, collections::HashMap, sync::Arc};

thread_local! {
    // Renderer main thread only.
    static ROUTER: Arc<RendererSideRouter> = RendererSideRouter::new(MessageRouterConfig::default());
    /// Browser id → the script its creator handed over in `extra_info` (main window only; popups get none).
    static SCRIPTS: RefCell<HashMap<i32, String>> = RefCell::new(HashMap::new());
}

wrap_render_process_handler! {
    pub struct MercuryRenderer {}

    impl RenderProcessHandler {
        fn on_browser_created(&self, browser: Option<&mut Browser>, extra_info: Option<&mut DictionaryValue>) {
            let (Some(browser), Some(info)) = (browser, extra_info) else { return };
            let script = CefString::from(&info.string(Some(&CefString::from("script")))).to_string();
            if !script.is_empty() {
                SCRIPTS.with(|s| s.borrow_mut().insert(browser.identifier(), script));
            }
        }

        fn on_browser_destroyed(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                SCRIPTS.with(|s| s.borrow_mut().remove(&browser.identifier()));
            }
        }

        // Runs before any page script, so the bundle sees pristine built-ins and can hide cefQuery from the page.
        fn on_context_created(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            context: Option<&mut V8Context>,
        ) {
            let (browser, frame, context) = (browser.cloned(), frame.cloned(), context.cloned());
            ROUTER.with(|r| r.on_context_created(browser.clone(), frame.clone(), context.clone()));
            let (Some(browser), Some(frame), Some(context)) = (browser, frame, context) else { return };
            if frame.is_main() == 0 || !CefString::from(&frame.url()).to_string().starts_with(HOME) {
                return;
            }
            SCRIPTS.with(|s| {
                let Some(script) = s.borrow().get(&browser.identifier()).cloned() else { return };
                let (mut value, mut exception) = (None, None);
                context.eval(
                    Some(&CefString::from(script.as_str())),
                    Some(&CefString::from("mercury://frontend.js")),
                    1,
                    Some(&mut value),
                    Some(&mut exception),
                );
            });
        }

        fn on_context_released(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            context: Option<&mut V8Context>,
        ) {
            ROUTER.with(|r| r.on_context_released(browser.cloned(), frame.cloned(), context.cloned()));
        }

        fn on_process_message_received(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> i32 {
            ROUTER.with(|r| {
                r.on_process_message_received(browser.cloned(), frame.cloned(), Some(source_process), message.cloned())
            }) as i32
        }
    }
}
