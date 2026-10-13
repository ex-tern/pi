//! A small virtual DOM. Views build a tree of `Node`s on every change; `Dom::render` compares it with what is on
//! the page and makes only the changes, so a field being typed in keeps its focus and caret.
//!
//! Children are matched by position. Events come back as the handle of the node they happened on, which finds
//! the handler the latest render gave it.

use crate::host;
use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;

/// A message that takes in what happened (a pointer's place).
pub trait Fill {
    fn fill(self, v: String) -> Self;
}

pub enum Handler<M> {
    /// The same message whatever happened (a message that wants it is filled in: `Fill`).
    Msg(M),
    /// A message made from the node's value (an input's text, a checkbox's "1"/"0", chosen files).
    Val(fn(String) -> M),
}

impl<M: Clone> Clone for Handler<M> {
    fn clone(&self) -> Self {
        match self {
            Handler::Msg(m) => Handler::Msg(m.clone()),
            Handler::Val(f) => Handler::Val(*f),
        }
    }
}

pub enum Node<M> {
    El(El<M>),
    Text(String),
}

pub struct El<M> {
    tag: &'static str,
    attrs: Vec<(&'static str, String)>,
    props: Vec<(&'static str, String)>,
    on: Vec<(&'static str, Handler<M>)>,
    kids: Vec<Node<M>>,
}

pub fn el<M>(tag: &'static str) -> El<M> {
    El { tag, attrs: Vec::new(), props: Vec::new(), on: Vec::new(), kids: Vec::new() }
}

pub fn txt<M>(s: impl Into<String>) -> Node<M> {
    Node::Text(s.into())
}

impl<M> El<M> {
    pub fn cls(mut self, c: &str) -> Self {
        if c.is_empty() {
            return self;
        }
        if let Some((_, v)) = self.attrs.iter_mut().find(|(k, _)| *k == "class") {
            v.push(' ');
            v.push_str(c);
        } else {
            self.attrs.push(("class", String::from(c)));
        }
        self
    }
    pub fn cls_if(self, cond: bool, c: &str) -> Self {
        if cond { self.cls(c) } else { self }
    }
    pub fn attr(mut self, k: &'static str, v: impl Into<String>) -> Self {
        self.attrs.push((k, v.into()));
        self
    }
    pub fn attr_if(self, cond: bool, k: &'static str, v: impl Into<String>) -> Self {
        if cond { self.attr(k, v) } else { self }
    }
    /// A DOM property rather than an attribute: `value` of a field, `checked` of a box ("1"/"0").
    pub fn prop(mut self, k: &'static str, v: impl Into<String>) -> Self {
        self.props.push((k, v.into()));
        self
    }
    pub fn style(self, v: impl Into<String>) -> Self {
        self.attr("style", v)
    }
    pub fn on(mut self, kind: &'static str, m: M) -> Self {
        self.on.push((kind, Handler::Msg(m)));
        self
    }
    pub fn on_val(mut self, kind: &'static str, f: fn(String) -> M) -> Self {
        self.on.push((kind, Handler::Val(f)));
        self
    }
    pub fn kid(mut self, n: impl Into<Node<M>>) -> Self {
        self.kids.push(n.into());
        self
    }
    pub fn kid_if(self, cond: bool, f: impl FnOnce() -> Node<M>) -> Self {
        if cond { self.kid(f()) } else { self }
    }
    pub fn kids(mut self, ns: impl IntoIterator<Item = Node<M>>) -> Self {
        self.kids.extend(ns);
        self
    }
    pub fn text(mut self, s: impl Into<String>) -> Self {
        self.kids.push(Node::Text(s.into()));
        self
    }
}

impl<M> From<El<M>> for Node<M> {
    fn from(e: El<M>) -> Self {
        Node::El(e)
    }
}

impl<M> From<String> for Node<M> {
    fn from(s: String) -> Self {
        Node::Text(s)
    }
}

impl<M> From<&str> for Node<M> {
    fn from(s: &str) -> Self {
        Node::Text(String::from(s))
    }
}

/// What is on the page, as last drawn.
struct Mounted {
    id: u32,
    tag: &'static str, // "" for a text node
    text: String,
    attrs: Vec<(&'static str, String)>,
    props: Vec<(&'static str, String)>,
    listening: Vec<&'static str>,
    kids: Vec<Mounted>,
}

pub struct Dom<M> {
    root: u32,
    tree: Option<Mounted>,
    handlers: BTreeMap<u32, Vec<(&'static str, Handler<M>)>>,
}

impl<M: Clone + Fill> Dom<M> {
    pub fn new(root: u32) -> Self {
        Dom { root, tree: None, handlers: BTreeMap::new() }
    }

    pub fn render(&mut self, node: Node<M>) {
        match self.tree.take() {
            None => {
                let m = self.create(node);
                host::append_child(self.root, m.id);
                self.tree = Some(m);
            }
            Some(mut old) => {
                self.patch(self.root, &mut old, node);
                self.tree = Some(old);
            }
        }
    }

    pub fn dispatch(&self, id: u32, kind: &str, value: String) -> Option<M> {
        let hs = self.handlers.get(&id)?;
        let (_, h) = hs.iter().find(|(k, _)| *k == kind)?;
        Some(match h {
            Handler::Msg(m) => m.clone().fill(value),
            Handler::Val(f) => f(value),
        })
    }

    fn create(&mut self, node: Node<M>) -> Mounted {
        match node {
            Node::Text(s) => {
                let id = host::create_text(&s);
                Mounted { id, tag: "", text: s, attrs: Vec::new(), props: Vec::new(), listening: Vec::new(), kids: Vec::new() }
            }
            Node::El(e) => {
                let id = host::create_el(e.tag);
                for (k, v) in &e.attrs {
                    host::set_attr(id, k, v);
                }
                for (k, v) in &e.props {
                    host::set_prop(id, k, v);
                }
                let mut listening = Vec::new();
                for (k, _) in &e.on {
                    if !listening.contains(k) {
                        host::listen(id, k);
                        listening.push(*k);
                    }
                }
                if !e.on.is_empty() {
                    self.handlers.insert(id, e.on);
                }
                let mut kids = Vec::with_capacity(e.kids.len());
                for k in e.kids {
                    let m = self.create(k);
                    host::append_child(id, m.id);
                    kids.push(m);
                }
                Mounted { id, tag: e.tag, text: String::new(), attrs: e.attrs, props: e.props, listening, kids }
            }
        }
    }

    fn forget(&mut self, m: &Mounted) {
        self.handlers.remove(&m.id);
        for k in &m.kids {
            self.forget(k);
            host::release(k.id);
        }
    }

    fn destroy(&mut self, m: Mounted) {
        self.forget(&m);
        host::remove(m.id);
    }

    fn patch(&mut self, parent: u32, old: &mut Mounted, new: Node<M>) {
        match new {
            Node::Text(s) if old.tag.is_empty() => {
                if old.text != s {
                    host::set_text(old.id, &s);
                    old.text = s;
                }
            }
            Node::El(e) if old.tag == e.tag => {
                let id = old.id;
                for (k, v) in &e.attrs {
                    match old.attrs.iter().find(|(ok, _)| ok == k) {
                        Some((_, ov)) if ov == v => {}
                        _ => host::set_attr(id, k, v),
                    }
                }
                for (k, _) in &old.attrs {
                    if !e.attrs.iter().any(|(nk, _)| nk == k) {
                        host::remove_attr(id, k);
                    }
                }
                old.attrs = e.attrs;
                for (k, v) in &e.props {
                    match old.props.iter().find(|(ok, _)| ok == k) {
                        Some((_, ov)) if ov == v => {}
                        _ => host::set_prop(id, k, v),
                    }
                }
                old.props = e.props;
                for (k, _) in &e.on {
                    if !old.listening.contains(k) {
                        host::listen(id, k);
                        old.listening.push(*k);
                    }
                }
                if e.on.is_empty() {
                    self.handlers.remove(&id);
                } else {
                    self.handlers.insert(id, e.on);
                }
                let n = e.kids.len();
                for (i, k) in e.kids.into_iter().enumerate() {
                    if i < old.kids.len() {
                        let mut slot = core::mem::replace(&mut old.kids[i], Mounted::placeholder());
                        self.patch(id, &mut slot, k);
                        old.kids[i] = slot;
                    } else {
                        let m = self.create(k);
                        host::append_child(id, m.id);
                        old.kids.push(m);
                    }
                }
                while old.kids.len() > n {
                    let m = old.kids.pop().unwrap();
                    self.destroy(m);
                }
            }
            other => {
                let m = self.create(other);
                host::insert_before(parent, m.id, old.id);
                let gone = core::mem::replace(old, m);
                self.destroy(gone);
            }
        }
    }
}

impl Mounted {
    fn placeholder() -> Self {
        Mounted { id: 0, tag: "", text: String::new(), attrs: Vec::new(), props: Vec::new(), listening: Vec::new(), kids: Vec::new() }
    }
}
