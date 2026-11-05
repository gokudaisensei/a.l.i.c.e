import { Elysia } from "elysia";

export const favoritesController = new Elysia({ name: "module.favorites", prefix: "/favorites", tags: ["favorites"] }).get(
  "/",
  () => ({ module: "favorites", status: "not_implemented" as const }),
  { detail: { summary: "Personalized device shortcuts" } },
);
