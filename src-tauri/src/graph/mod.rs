use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Segment {
    pub from: usize,
    pub to: usize,
    pub color: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
    pub refs: String,
    pub lane: usize,
    pub color: usize,
    pub entered: bool,
    pub segments: Vec<Segment>,
}
#[derive(Clone)]
pub struct Lane {
    pub hash: String,
    pub color: usize,
}

const COLORS: usize = 8;

fn free_color(active: &[Lane]) -> usize {
    (0..COLORS)
        .find(|color| active.iter().all(|lane| lane.color != *color))
        .unwrap_or(active.len() % COLORS)
}

fn position(active: &[Lane], hash: &str) -> Option<usize> {
    active.iter().position(|lane| lane.hash == hash)
}

#[derive(Clone, Copy)]
struct Placement {
    lane: usize,
    color: usize,
}
impl Placement {
    fn color_toward(&self, parent_index: usize, target: &Lane) -> usize {
        if parent_index == 0 {
            return self.color;
        }
        target.color
    }
}

fn open_lane(active: &mut Vec<Lane>, hash: &str) -> usize {
    active.push(Lane {
        hash: hash.to_owned(),
        color: free_color(active),
    });
    active.len() - 1
}
fn continue_first_parent(active: &mut Vec<Lane>, parents: &[String], placement: Placement) {
    let Some(first) = parents.first() else {
        return;
    };
    let waiting = position(active, first);
    let waits_on_the_left = waiting.is_some_and(|waiting| waiting < placement.lane);
    if waits_on_the_left {
        return;
    }
    if let Some(waiting) = waiting {
        active.remove(waiting);
    }
    active.insert(
        placement.lane,
        Lane {
            hash: first.clone(),
            color: placement.color,
        },
    );
}
fn open_merge_parents(active: &mut Vec<Lane>, parents: &[String], lane: usize) {
    for (offset, parent) in parents.iter().enumerate().skip(1) {
        if position(active, parent).is_some() {
            continue;
        }
        let color = free_color(active);
        active.insert(
            (lane + offset).min(active.len()),
            Lane {
                hash: parent.clone(),
                color,
            },
        );
    }
}
fn passing_segments(before: &[Lane], active: &[Lane], lane: usize) -> Vec<Segment> {
    before
        .iter()
        .enumerate()
        .filter(|(from, _)| *from != lane)
        .filter_map(|(from, entry)| {
            position(active, &entry.hash).map(|to| Segment {
                from,
                to,
                color: entry.color,
            })
        })
        .collect()
}
fn parent_segments(active: &[Lane], parents: &[String], placement: Placement) -> Vec<Segment> {
    parents
        .iter()
        .enumerate()
        .filter_map(|(index, parent)| {
            position(active, parent).map(|to| Segment {
                from: placement.lane,
                to,
                color: placement.color_toward(index, &active[to]),
            })
        })
        .collect()
}
fn place(commit: &mut Commit, active: &mut Vec<Lane>) {
    let found = position(active, &commit.hash);
    let lane = found.unwrap_or_else(|| open_lane(active, &commit.hash));
    let before = active.clone();
    let placement = Placement {
        lane,
        color: before[lane].color,
    };
    active.remove(lane);
    continue_first_parent(active, &commit.parents, placement);
    open_merge_parents(active, &commit.parents, lane);
    let mut segments = passing_segments(&before, active, lane);
    segments.extend(parent_segments(active, &commit.parents, placement));
    commit.lane = lane;
    commit.color = placement.color;
    commit.entered = found.is_some();
    commit.segments = segments;
}
pub fn lanes(commits: &mut [Commit], active: &mut Vec<Lane>) {
    for commit in commits {
        place(commit, active);
    }
}
