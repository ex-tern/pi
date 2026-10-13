"""SCHOLARPI_SHAPE=superellipse decides the look before the first paint: index.html is served with the
shape-se class stamped into its inline script, so a first visit lays out the superellipse site at once."""
import os

import api as shape

HERE = os.path.dirname(__file__)
INDEX = os.path.join(HERE, "..", "..", "frontend", "index.html")


def _index():
    with open(INDEX, encoding="utf-8") as fh:
        return fh.read()


def test_index_decides_the_look_up_front():
    assert 'h.classList.add("orbit-on");' in _index()          # what the stamp looks for


def test_superellipse_deployment_stamps_the_class():
    html = shape.stamp(_index(), "superellipse")
    assert 'h.classList.add("orbit-on","shape-se")' in html
    assert shape.stamp(_index(), " Superellipse ") == html


def test_other_deployments_leave_index_alone():
    for value in (None, "", "round", "circle"):
        assert shape.stamp(_index(), value) == _index()
