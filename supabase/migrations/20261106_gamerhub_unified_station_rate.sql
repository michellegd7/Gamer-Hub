-- Standardize the advertised hourly station rate across PC, VIP, and console stations.
-- Playtime package prices remain separately configured in playtime_packages.
update public.stations
set hourly_rate = 50,
    updated_at = now();
