SELECT billable AS label, COUNT(*)::int AS value
FROM nb_pm_time_entries
GROUP BY billable
ORDER BY value DESC, label ASC;
