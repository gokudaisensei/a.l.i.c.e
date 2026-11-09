"use client";
import { Avatar, Button, IconButton, Popover, PopoverClose, Icon } from "@/ui";

export default function Basic() {
  return (
    <Popover trigger={<IconButton aria-label="Account"><Avatar initial="G" tone={1} /></IconButton>} title="Gokul" align="start">
      <p className="small">Admin · passkey</p>
      <PopoverClose render={<Button size="sm" />}><Icon n="exit" c="sm" />Sign out</PopoverClose>
    </Popover>
  );
}
