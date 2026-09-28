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

pub fn lanes(commits: &mut [Commit], active: &mut Vec<Lane>) {
    for commit in commits {
        let found = position(active, &commit.hash);
        let lane = found.unwrap_or_else(|| {
            active.push(Lane {
                hash: commit.hash.clone(),
                color: free_color(active),
            });
            active.len() - 1
        });
        let before = active.clone();
        let color = before[lane].color;
        active.remove(lane);
        if let Some(first) = commit.parents.first() {
            match position(active, first) {
                Some(waiting) if waiting < lane => {}
                waiting => {
                    if let Some(waiting) = waiting {
                        active.remove(waiting);
                    }
                    active.insert(
                        lane,
                        Lane {
                            hash: first.clone(),
                            color,
                        },
                    );
                }
            }
        }
        for (offset, parent) in commit.parents.iter().enumerate().skip(1) {
            if position(active, parent).is_none() {
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
        let mut segments = Vec::new();
        for (from, entry) in before.iter().enumerate() {
            if from != lane {
                if let Some(to) = position(active, &entry.hash) {
                    segments.push(Segment {
                        from,
                        to,
                        color: entry.color,
                    });
                }
            }
        }
        for (index, parent) in commit.parents.iter().enumerate() {
            if let Some(to) = position(active, parent) {
                segments.push(Segment {
                    from: lane,
                    to,
                    color: if index == 0 { color } else { active[to].color },
                });
            }
        }
        commit.lane = lane;
        commit.color = color;
        commit.entered = found.is_some();
        commit.segments = segments;
    }
}
