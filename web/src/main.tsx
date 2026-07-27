import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import {
  AdminBusinesses, AdminUsers, App, BotRules, BusinessSettings, Businesses,
  ForgotPassword, Inbox, Login, Members, Metrics, Register, ResetPassword,
} from "./pages";
import "./styles.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Switch>
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route path="/admin/users" component={AdminUsers} />
          <Route path="/admin/businesses" component={AdminBusinesses} />
          <Route path="/businesses/:id/inbox" component={Inbox} />
          <Route path="/businesses/:id/bot-rules" component={BotRules} />
          <Route path="/businesses/:id/members" component={Members} />
          <Route path="/businesses/:id/metrics" component={Metrics} />
          <Route path="/businesses/:id" component={BusinessSettings} />
          <Route exact path="/businesses" component={Businesses} />
          <Route path="/" component={App} />
        </Switch>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
