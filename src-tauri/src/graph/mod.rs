use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Segment {
    pub from: usize,
    pub to: usize,
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
    pub segments: Vec<Segment>,
}

pub fn lanes(commits: &mut [Commit], active: &mut Vec<String>) {
    for commit in commits {
        let lane = active
            .iter()
            .position(|hash| hash == &commit.hash)
            .unwrap_or_else(|| {
                active.push(commit.hash.clone());
                active.len() - 1
            });
        let before = active.clone();
        active.remove(lane);
        for (offset, parent) in commit.parents.iter().enumerate() {
            if !active.contains(parent) {
                active.insert((lane + offset).min(active.len()), parent.clone());
            }
        }
        let mut segments = Vec::new();
        for (from, hash) in before.iter().enumerate() {
            if from != lane {
                if let Some(to) = active.iter().position(|h| h == hash) {
                    segments.push(Segment { from, to });
                }
            }
        }
        for parent in &commit.parents {
            if let Some(to) = active.iter().position(|h| h == parent) {
                segments.push(Segment { from: lane, to });
            }
        }
        commit.lane = lane;
        commit.segments = segments;
    }
}
