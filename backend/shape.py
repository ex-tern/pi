"""The look a deployment serves: SCHOLARPI_SHAPE=superellipse stamps the superellipse look into index.html.

The look is decided before the first paint, by the inline script at the top of index.html (orbit-on, and
shape-se on se.* / super.* host names or ?shape=se). A deployment that sets SCHOLARPI_SHAPE=superellipse on
another host name used to tell the page through /api/build after it had loaded, by which time the modules
that lay out a first visit (super/nodes.js, live.js, super/logo.js) had decided for the round look, so a
first-time visitor got a round-look page in superellipse clothes: no central super, no port wires, Live
docked. The class is stamped into the document on the way out instead (api.py _versioned_index).
"""

SUPERELLIPSE = "superellipse"
_ROUND = 'h.classList.add("orbit-on");'
_SE = 'h.classList.add("orbit-on","shape-se");'


def stamp(html: str, shape: str) -> str:
    """index.html as served: with shape-se decided up front when the deployment's shape is superellipse."""
    if (shape or "").strip().lower() == SUPERELLIPSE:
        return html.replace(_ROUND, _SE, 1)
    return html
