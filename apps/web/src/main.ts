import { createApp } from "vue";
import { registerOsxComponents } from "@vraxis/osx-components";
import "@vraxis/osx-components/theme.css";
import App from "./App.vue";
import { installCsrfFetch } from "./security/csrf-fetch.js";
import "./styles.css";

installCsrfFetch();
registerOsxComponents();
createApp(App).mount("#app");
