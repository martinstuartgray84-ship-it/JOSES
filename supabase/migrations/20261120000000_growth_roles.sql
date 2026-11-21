-- Growth Console: a read-only role. In its own migration because a new enum
-- value cannot be used in the transaction that adds it.
-- The console's four roles map onto venue_role as: owner, manager, captain = host, viewer.
alter type venue_role add value if not exists 'viewer' after 'host';
