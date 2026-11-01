import type { Client } from "./http.ts";

export const DEFAULT_CUSTOMER_PASSWORD = "test-password-123";

/** Register a customer; the response also signs them in (session cookie). */
export async function registerCustomer(
  client: Client,
  email: string,
  password: string = DEFAULT_CUSTOMER_PASSWORD,
  name = "Test Customer",
) {
  return client.request("/register", { form: { name, email, password } });
}

export async function signIn(client: Client, email: string, password: string) {
  return client.request("/login", { form: { email, password } });
}

export const SEED = {
  adminEmail: "admin@cutwell.test",
  adminPassword: "cutwell-admin-1",
  stylistPassword: "cutwell-stylist-1",
};
