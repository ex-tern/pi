"""Website traffic by day: distinct visitors and visits, never who."""

import sqlite3
from datetime import date

import traffic


def conn_factory(path):
    return lambda: sqlite3.connect(path)


def test_series_counts_and_windows(tmp_path):
    get = conn_factory(str(tmp_path / "t.db"))
    c = get(); traffic.ensure_table(c)
    c.execute("CREATE TABLE site_visits (visitor_key TEXT PRIMARY KEY)")
    c.executemany("INSERT INTO site_visits VALUES (?)", [("a",), ("b",), ("c",), ("old",)])
    c.executemany("INSERT INTO site_traffic VALUES (?,?,?)", [
        ("2026-10-10", "a", 3), ("2026-10-10", "b", 1),
        ("2026-10-08", "a", 1), ("2026-10-01", "c", 2), ("2026-08-01", "old", 1)])
    c.commit(); c.close()
    s = traffic.summary(get, 30, today=date(2026, 10, 10))
    assert len(s["days"]) == 30 and s["days"][-1] == {"day": "2026-10-10", "visitors": 2, "visits": 4}
    assert s["days"][-2] == {"day": "2026-10-09", "visitors": 0, "visits": 0}   # gaps filled
    assert s["today"] == 2 and s["week"] == 2 and s["month"] == 3 and s["all_time"] == 4
    assert s["visits_30d"] == 7
    assert "visitor_key" not in str(s)


def test_record_upserts_and_prunes(tmp_path):
    get = conn_factory(str(tmp_path / "t.db"))
    traffic.record(get, "k1"); traffic.record(get, "k1"); traffic.record(get, "k2"); traffic.record(get, "")
    c = get()
    rows = dict(c.execute("SELECT visitor_key, visits FROM site_traffic").fetchall())
    assert rows == {"k1": 2, "k2": 1}
    c.execute("INSERT INTO site_traffic VALUES (DATE('now','-200 day'), 'ancient', 1)"); c.commit(); c.close()
    traffic.record(get, "k3")
    c = get()
    assert c.execute("SELECT COUNT(*) FROM site_traffic WHERE visitor_key='ancient'").fetchone()[0] == 0
